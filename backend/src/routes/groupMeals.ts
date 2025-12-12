import { Router } from "express";
import { z } from "zod";
import {
  AvailabilityStatus,
  GroupMeal,
  GroupMealBudget,
  GroupMealMode,
  GroupMealParticipantStatus,
  GroupMealStatus,
  MealTimeSlot,
  TimeSlot,
  Weekday,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { getApprovedMembership } from "../utils/membership.js";
import { computeExpiresAt } from "../utils/availabilityHelpers.js";
import { pushGroupMealInviteNotification } from "../lib/lineMessages.js";
import { canManageGroupMeal } from "../auth/permissions.js";
import {
  ACTIVE_PARTICIPANT_STATUSES,
  ATTENDING_PARTICIPANT_STATUSES,
  getCountedParticipantsForGroupMeal,
} from "../utils/groupMealParticipants.js";
import {
  getGroupMealHeadcountTx,
  getGroupMealRemainingCapacityTx,
} from "../services/groupMealsService.js";

type ApprovedMembership = NonNullable<
  Awaited<ReturnType<typeof getApprovedMembership>>
>;

const placeSchema = z.object({
  name: z.string().min(1),
  address: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  googlePlaceId: z.string().nullable().optional(),
});

const budgetEnumSchema = z.enum([
  "UNDER_1000",
  "UNDER_1500",
  "UNDER_2000",
  "OVER_2000",
]);

const budgetInputSchema = z
  .union([z.number().int(), budgetEnumSchema])
  .nullable()
  .optional();

const meetUrlSchema = z
  .string()
  .url("meetUrl must be a valid URL")
  .max(2048)
  .optional();

const scheduleTimeBandSchema = z.enum(["LUNCH", "DINNER"]);
type ScheduleTimeBand = z.infer<typeof scheduleTimeBandSchema>;

const groupMealModeSchema = z.enum(["REAL", "MEET"]);
type GroupMealModeInput = z.infer<typeof groupMealModeSchema>;

const scheduleSchema = z.object({
  date: z
    .string()
    // 'YYYY-MM-DD' 形式に限定する
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format"),
  timeBand: scheduleTimeBandSchema,
  // meetingTime は null も許容（フロントから null が来る可能性がある）
  meetingTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "meetingTime must be HH:MM")
    .nullable()
    .optional(),
  place: placeSchema.optional(),
});

// ① ネスト形式: { title, capacity, budget, schedule: { ... } }
const createGroupMealNestedSchema = z.object({
  title: z.string().optional().default(""),
  capacity: z.number().int().positive(),
  budget: budgetInputSchema,
  schedule: scheduleSchema,
  mode: groupMealModeSchema.optional(),
  meetUrl: meetUrlSchema,
});

// ② フラット形式: { title, date, timeBand, meetingTime, capacity, budget, place* }
const createGroupMealFlatSchema = z.object({
  title: z.string().optional().default(""),
  date: scheduleSchema.shape.date,
  timeBand: scheduleSchema.shape.timeBand,
  meetingTime: scheduleSchema.shape.meetingTime,
  capacity: z.number().int().positive(),
  budget: budgetInputSchema,
  placeName: z.string().optional(),
  placeAddress: z.string().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  mode: groupMealModeSchema.optional(),
  meetUrl: meetUrlSchema,
});

const scheduleUpdateSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  timeBand: scheduleTimeBandSchema.optional(),
  meetingTime: z
    .union([z.string().regex(/^\d{2}:\d{2}$/), z.null()])
    .optional(),
  place: placeSchema.nullable().optional(),
});

const updateGroupMealSchema = z.object({
  schedule: scheduleUpdateSchema.optional(),
  meetingPlace: z.string().trim().max(255).optional(),
  meetUrl: meetUrlSchema,
});
type UpdateGroupMealInput = z.infer<typeof updateGroupMealSchema>;

const editableGroupMealFieldsSchema = z
  .object({
    title: z.string().trim().max(255).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format")
      .optional(),
    timeSlot: z.nativeEnum(TimeSlot).optional(),
    gatherTime: z
      .union([z.string().regex(/^\d{2}:\d{2}$/), z.null()])
      .optional(),
    capacity: z.number().int().positive().optional(),
    nearestStation: z
      .union([z.string().trim().min(1).max(255), z.null()])
      .optional(),
    budget: z.nativeEnum(GroupMealBudget).nullable().optional(),
  })
  .strict();

const EDITABLE_GROUP_MEAL_KEYS = [
  "title",
  "date",
  "timeSlot",
  "gatherTime",
  "capacity",
  "nearestStation",
  "budget",
] as const;

function hasEditableGroupMealFields(body: any): body is Record<string, unknown> {
  if (!body || typeof body !== "object") {
    return false;
  }
  return EDITABLE_GROUP_MEAL_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(body, key)
  );
}

const inviteSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
});

const respondSchema = z.object({
  action: z.enum(["ACCEPT", "DECLINE"]),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const groupMealIdParamSchema = z.object({
  groupMealId: z.string().uuid(),
});

const invitationIdParamSchema = z.object({
  invitationId: z.string().uuid(),
});

const cancelInvitationParamsSchema = z.object({
  invitationId: z.string().min(1, "invitationId is required"),
});

function parseScheduleDate(dateString: string): Date {
  const parsed = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid schedule date");
  }
  return parsed;
}

function mapTimeBandToTimeSlot(timeBand: ScheduleTimeBand): TimeSlot {
  return timeBand === "LUNCH" ? TimeSlot.DAY : TimeSlot.NIGHT;
}

function mapTimeBandToMealTimeSlot(timeBand: ScheduleTimeBand): MealTimeSlot {
  return timeBand === "LUNCH" ? MealTimeSlot.LUNCH : MealTimeSlot.DINNER;
}

function mapTimeSlotToTimeBand(timeSlot: TimeSlot): ScheduleTimeBand {
  return timeSlot === TimeSlot.DAY ? "LUNCH" : "DINNER";
}

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function validateMeetingTime(minutes: number, timeBand: ScheduleTimeBand) {
  const { min, max } =
    timeBand === "LUNCH"
      ? { min: 10 * 60, max: 15 * 60 }
      : { min: 18 * 60, max: 23 * 60 };
  if (minutes < min || minutes > max) {
    throw new Error("meetingTime is out of allowed range for this timeBand");
  }
  if (minutes % 30 !== 0) {
    throw new Error("meetingTime must be in 30-minute increments");
  }
}

function formatDateToIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const BUDGET_ENUM_VALUES = [
  "UNDER_1000",
  "UNDER_1500",
  "UNDER_2000",
  "OVER_2000",
] as const;
type BudgetEnumValue = (typeof BUDGET_ENUM_VALUES)[number];

function mapBudgetValueToEnum(
  value: number | BudgetEnumValue | null | undefined
): GroupMealBudget | null {
  if (value == null) return null;

  if (typeof value === "string") {
    if (BUDGET_ENUM_VALUES.includes(value as BudgetEnumValue)) {
      return value as GroupMealBudget;
    }
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return mapBudgetValueToEnum(parsed);
    }
    return null;
  }

  if (value <= 1000) return GroupMealBudget.UNDER_1000;
  if (value <= 1500) return GroupMealBudget.UNDER_1500;
  if (value <= 2000) return GroupMealBudget.UNDER_2000;
  return GroupMealBudget.OVER_2000;
}

function membershipIsHost(
  membership: ApprovedMembership | null,
  groupMeal: { hostMembershipId?: string | null; hostUserId: string }
) {
  if (!membership) return false;
  if (groupMeal.hostMembershipId) {
    return membership.id === groupMeal.hostMembershipId;
  }
  return membership.userId === groupMeal.hostUserId;
}

const updateParticipantStatusSchema = z.object({
  status: z.enum(["JOINED", "LATE", "CANCELLED"]),
});

const membershipRequiredResponse = {
  message:
    "コミュニティ参加後にご利用ください。先に参加コードで /api/community/join を呼び出してください。",
  status: "UNAPPLIED",
  action: "JOIN_REQUIRED",
};

type ParticipantWithUser = Prisma.GroupMealParticipantGetPayload<{
  include: { user: { include: { profile: true } } };
}>;

type UserWithProfile = Prisma.UserGetPayload<{ include: { profile: true } }>;

type GroupMealWithRelations = GroupMeal & {
  participants: ParticipantWithUser[];
  host: UserWithProfile;
};

function buildSchedulePayloadFromGroupMeal(groupMeal: GroupMealWithRelations) {
  const meetingTimeMinutes = groupMeal.meetingTimeMinutes ?? null;
  const placeName = groupMeal.placeName ?? groupMeal.meetingPlace ?? null;
  const place =
    placeName == null
      ? null
      : {
          name: placeName,
          address: groupMeal.placeAddress ?? null,
          latitude: groupMeal.placeLatitude ?? null,
          longitude: groupMeal.placeLongitude ?? null,
          googlePlaceId: groupMeal.placeGooglePlaceId ?? null,
        };

  return {
    date: formatDateToIsoDay(groupMeal.date),
    timeBand: mapTimeSlotToTimeBand(groupMeal.timeSlot),
    meetingTime:
      meetingTimeMinutes !== null
        ? formatMinutesToTimeString(meetingTimeMinutes)
        : null,
    meetingTimeMinutes,
    place,
  };
}

function getNearestStationFromGroupMeal(groupMeal: GroupMealWithRelations) {
  return (
    groupMeal.meetingPlace ??
    groupMeal.locationName ??
    groupMeal.placeName ??
    null
  );
}

type PrismaClientOrTx = {
  groupMealParticipant: typeof prisma.groupMealParticipant;
  groupMeal: typeof prisma.groupMeal;
};

const WEEKDAY_FROM_UTCDAY: Weekday[] = [
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
];

function getWeekdayFromDate(date: Date): Weekday {
  return WEEKDAY_FROM_UTCDAY[date.getUTCDay()];
}

function isActiveParticipant(status: GroupMealParticipantStatus): boolean {
  return ACTIVE_PARTICIPANT_STATUSES.includes(status);
}

function buildParticipantPayload(participant: ParticipantWithUser) {
  return {
    userId: participant.userId,
    isHost: participant.isHost,
    status: participant.status,
    name: participant.user.profile?.name || "",
    favoriteMeals: participant.user.profile?.favoriteMeals || [],
    profileImageUrl: participant.user.profile?.profileImageUrl ?? null,
  };
}

function getMyStatus(participants: ParticipantWithUser[], userId: string) {
  const me = participants.find((p) => p.userId === userId);
  if (!me) return "NONE" as const;
  if (me.status === GroupMealParticipantStatus.JOINED) return "JOINED" as const;
  if (me.status === GroupMealParticipantStatus.INVITED)
    return "INVITED" as const;
  if (me.status === GroupMealParticipantStatus.LATE) return "LATE" as const;
  return "NONE" as const;
}

function buildGroupMealPayload(
  groupMeal: GroupMealWithRelations,
  currentUserId?: string,
  opts: { joinedOnly?: boolean } = {}
) {
  const joinedCount = getCountedParticipantsForGroupMeal(groupMeal).length;
  const participants = (
    opts.joinedOnly
      ? groupMeal.participants.filter((p: any) =>
          ATTENDING_PARTICIPANT_STATUSES.includes(p.status)
        )
      : groupMeal.participants
  ).map(buildParticipantPayload);
  const nearestStation = getNearestStationFromGroupMeal(groupMeal);

  return {
    id: groupMeal.id,
    title: groupMeal.title,
    date: groupMeal.date.toISOString(),
    weekday: groupMeal.weekday,
    timeSlot: groupMeal.timeSlot,
    capacity: groupMeal.capacity,
    status: groupMeal.status,
    mode: groupMeal.mode,
    meetUrl: groupMeal.meetUrl ?? null,
    host: {
      userId: groupMeal.hostUserId,
      name: groupMeal.host.profile?.name || "",
      profileImageUrl: groupMeal.host.profile?.profileImageUrl ?? null,
    },
    meetingPlace: groupMeal.meetingPlace ?? null,
    nearestStation,
    schedule: buildSchedulePayloadFromGroupMeal(groupMeal),
    budget: groupMeal.budget ?? null,
    joinedCount,
    remainingSlots: Math.max(groupMeal.capacity - joinedCount, 0),
    myStatus: currentUserId
      ? getMyStatus(groupMeal.participants, currentUserId)
      : undefined,
    participants,
  };
}

function buildGroupMealDetailResponse(
  groupMeal: GroupMealWithRelations,
  currentUserId: string
) {
  const payload = buildGroupMealPayload(groupMeal, currentUserId);
  const gatherTime =
    groupMeal.meetingTimeMinutes != null
      ? formatMinutesToTimeString(groupMeal.meetingTimeMinutes)
      : null;

  return {
    ...payload,
    gatherTime,
    organizer: {
      id: groupMeal.hostUserId,
      name: groupMeal.host.profile?.name || "",
      profileImageUrl: groupMeal.host.profile?.profileImageUrl ?? null,
    },
    nearestStation: payload.nearestStation,
    budgetOption: payload.budget,
  };
}

async function attachGroupMealRelations(
  groupMeals: GroupMeal[]
): Promise<GroupMealWithRelations[]> {
  if (groupMeals.length === 0) return [];

  const groupMealIds = groupMeals.map((gm) => gm.id);
  const participants = await prisma.groupMealParticipant.findMany({
    where: {
      groupMealId: { in: groupMealIds },
    },
    include: {
      user: { include: { profile: true } },
    },
  });

  const participantMap = new Map<string, ParticipantWithUser[]>();
  for (const participant of participants) {
    const list = participantMap.get(participant.groupMealId) ?? [];
    list.push(participant as ParticipantWithUser);
    participantMap.set(participant.groupMealId, list);
  }

  const hostIds = Array.from(new Set(groupMeals.map((gm) => gm.hostUserId)));
  const hosts = await prisma.user.findMany({
    where: {
      id: { in: hostIds },
    },
    include: { profile: true },
  });
  const hostMap = new Map(hosts.map((host) => [host.id, host]));

  return groupMeals.map((groupMeal) => ({
    ...groupMeal,
    participants: participantMap.get(groupMeal.id) ?? [],
    host: hostMap.get(groupMeal.hostUserId)!,
  }));
}

async function fetchGroupMeal(id: string) {
  const rows = (await prisma.$queryRaw`
    SELECT *
    FROM "GroupMeal"
    WHERE "id" = ${id}
    LIMIT 1
  `) as GroupMeal[];

  const groupMeal = rows[0];
  if (!groupMeal) {
    return null;
  }

  const [enriched] = await attachGroupMealRelations([groupMeal]);
  return enriched ?? null;
}

async function syncGroupMealStatus(
  db: PrismaClientOrTx,
  groupMealId: string,
  capacity: number,
  currentStatus: GroupMealStatus,
  hostUserId?: string
) {
  if (currentStatus === GroupMealStatus.CLOSED) {
    return currentStatus;
  }

  const where: Prisma.GroupMealParticipantWhereInput = {
    groupMealId,
    status: { in: ACTIVE_PARTICIPANT_STATUSES },
  };
  if (hostUserId) {
    where.OR = [
      { userId: { not: hostUserId } },
      { userId: hostUserId, isCreator: true },
    ];
  }

  const activeCount = await db.groupMealParticipant.count({ where });

  const nextStatus =
    activeCount >= capacity ? GroupMealStatus.FULL : GroupMealStatus.OPEN;
  if (nextStatus !== currentStatus) {
    await db.groupMeal.update({
      where: { id: groupMealId },
      data: { status: nextStatus },
    });
  }
  return nextStatus;
}

export const groupMealsRouter = Router();

groupMealsRouter.use(authMiddleware);

groupMealsRouter.post("/_debug", (req, res) => {
  console.log("[group-meals] debug hit", {
    userId: req.user?.userId,
    body: req.body,
  });
  return res.json({ ok: true });
});

// 認証済みの参加メンバーなら誰でも箱を作成可能（管理者も含む）
groupMealsRouter.post("/", async (req, res) => {
  const membership = await getApprovedMembership(req.user!.userId);
  if (!membership) {
    return res.status(400).json(membershipRequiredResponse);
  }

  const isAdmin = Boolean(req.user!.isAdmin);

  let parsed = createGroupMealNestedSchema.safeParse(req.body);
  if (!parsed.success) {
    const flatResult = createGroupMealFlatSchema.safeParse(req.body);

    if (!flatResult.success) {
      console.error("CREATE GROUP MEAL INVALID BODY", {
        body: req.body,
        nestedError: parsed.error.format(),
        flatError: flatResult.error.format(),
      });
      return res.status(400).json({ message: "Invalid input" });
    }

    const f = flatResult.data;
    parsed = {
      success: true,
      data: {
        title: f.title,
        capacity: f.capacity,
        budget: f.budget ?? null,
        mode: f.mode ?? undefined,
        meetUrl: f.meetUrl ?? undefined,
        schedule: {
          date: f.date,
          timeBand: f.timeBand,
          meetingTime: f.meetingTime ?? null,
          place:
            f.placeName && f.placeName.trim().length > 0
              ? {
                  name: f.placeName.trim(),
                  address: f.placeAddress?.trim() || null,
                  latitude: f.latitude ?? null,
                  longitude: f.longitude ?? null,
                  googlePlaceId: null,
                }
              : undefined,
        },
      },
    } as const;
  }

  const {
    title,
    capacity,
    budget,
    schedule,
    mode: rawMode,
    meetUrl: rawMeetUrl,
  } = parsed.data;
  const normalizedMode: GroupMealMode =
    rawMode === GroupMealMode.MEET ? GroupMealMode.MEET : GroupMealMode.REAL;
  const normalizedBudget = mapBudgetValueToEnum(budget ?? null);

  let meetUrl: string | null = null;
  if (normalizedMode === GroupMealMode.MEET) {
    if (!rawMeetUrl) {
      return res
        .status(400)
        .json({ message: "MeetでGO飯の箱には meetUrl が必須です" });
    }
    meetUrl = rawMeetUrl;
  }

  const date = parseScheduleDate(schedule.date);
  const weekday = getWeekdayFromDate(date);
  const timeSlot = mapTimeBandToTimeSlot(schedule.timeBand);

  const meetingTimeMinutes =
    schedule.meetingTime != null
      ? (() => {
          const [hours, minutes] = schedule.meetingTime.split(":").map(Number);
          return hours * 60 + minutes;
        })()
      : null;

  const mealTimeSlot = mapTimeBandToMealTimeSlot(schedule.timeBand);
  const expiresAt = computeExpiresAt(date, mealTimeSlot);

  if (meetingTimeMinutes !== null) {
    validateMeetingTime(meetingTimeMinutes, schedule.timeBand);
  }

  const isMeet = normalizedMode === GroupMealMode.MEET;
  const place = isMeet ? undefined : schedule.place;
  const placeName = isMeet ? null : place?.name ?? null;
  const placeAddress = isMeet ? null : place?.address ?? null;
  const placeLatitude = isMeet ? null : place?.latitude ?? null;
  const placeLongitude = isMeet ? null : place?.longitude ?? null;
  const placeGooglePlaceId = isMeet ? null : place?.googlePlaceId ?? null;

  const meetingPlace = isMeet ? null : placeName;
  const locationName = isMeet ? null : meetingPlace ?? placeName ?? null;
  const locationLatitude = isMeet ? null : placeLatitude ?? null;
  const locationLongitude = isMeet ? null : placeLongitude ?? null;

  const now = new Date();
  try {
    const groupMeal = await prisma.groupMeal.create({
      data: {
        communityId: membership.communityId,
        hostUserId: req.user!.userId,
        hostMembershipId: membership.id,
        title,
        date,
        weekday,
        timeSlot,
        mode: normalizedMode,
        mealTimeSlot,
        locationName,
        latitude: locationLatitude,
        longitude: locationLongitude,
        meetUrl,
        capacity,
        meetingPlace,
        meetingTimeMinutes,
        placeName,
        placeAddress,
        placeLatitude,
        placeLongitude,
        placeGooglePlaceId,
        budget: normalizedBudget,
        createdByUserId: req.user!.userId,
        expiresAt,
        talkTopics: [],
        participants: {
          create: {
            userId: req.user!.userId,
            isHost: true,
            isCreator: !isAdmin,
            status: GroupMealParticipantStatus.JOINED,
          },
        },
      },
    });

    const [enriched] = await attachGroupMealRelations([groupMeal]);
    if (!enriched) {
      throw new Error("Failed to load group meal relations");
    }

    return res
      .status(201)
      .json(buildGroupMealPayload(enriched, req.user!.userId));
  } catch (error: any) {
    console.error("CREATE GROUP MEAL ERROR", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

groupMealsRouter.patch("/:groupMealId", async (req, res, next) => {
  if (!hasEditableGroupMealFields(req.body)) {
    return next();
  }

  const parsedParams = groupMealIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res
      .status(400)
      .json({
        message: "Invalid group meal id",
        issues: parsedParams.error.flatten(),
      });
  }

  const parsedBody = editableGroupMealFieldsSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res
      .status(400)
      .json({ message: "Invalid body", issues: parsedBody.error.flatten() });
  }

  const groupMealId = parsedParams.data.groupMealId;
  const user = req.user!;
  const userId = user.userId;
  const isAdmin = Boolean(user.isAdmin);
  const membership = isAdmin ? null : await getApprovedMembership(userId);
  if (!isAdmin && !membership) {
    return res.status(400).json(membershipRequiredResponse);
  }

  const groupMeal = await prisma.groupMeal.findUnique({
    where: { id: groupMealId },
    select: {
      id: true,
      communityId: true,
      hostUserId: true,
      timeSlot: true,
      locationName: true,
      createdByUserId: true,
    },
  });
  if (!groupMeal) {
    return res.status(404).json({ message: "Group meal not found" });
  }

  if (!isAdmin && groupMeal.communityId !== membership!.communityId) {
    return res.status(403).json({ message: "別のコミュニティの募集です" });
  }

  if (!canManageGroupMeal({ user, groupMeal })) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const data: Prisma.GroupMealUpdateInput = {};

  try {
    const body = parsedBody.data;

    if (body.title !== undefined) {
      data.title = body.title;
    }

    if (body.date !== undefined) {
      const date = parseScheduleDate(body.date);
      data.date = date;
      data.weekday = getWeekdayFromDate(date);
    }

    if (body.timeSlot !== undefined) {
      data.timeSlot = body.timeSlot;
    }

    if (body.gatherTime !== undefined) {
      if (body.gatherTime === null) {
        data.meetingTimeMinutes = null;
      } else {
        const targetTimeSlot = body.timeSlot ?? groupMeal.timeSlot;
        const minutes = parseTimeToMinutes(body.gatherTime);
        const timeBand = mapTimeSlotToTimeBand(targetTimeSlot);
        validateMeetingTime(minutes, timeBand);
        data.meetingTimeMinutes = minutes;
      }
    }

    if (body.capacity !== undefined) {
      const headcount = await getGroupMealHeadcountTx(prisma, groupMealId);
      if (body.capacity < headcount) {
        return res.status(400).json({
          message: `定員(${body.capacity})は現在の参加人数(${headcount})より小さくできません。`,
        });
      }
      data.capacity = body.capacity;
    }

    if (body.nearestStation !== undefined) {
      data.meetingPlace = body.nearestStation;
      if (body.nearestStation === null) {
        data.locationName = null;
      } else if (groupMeal.locationName == null) {
        data.locationName = body.nearestStation;
      }
    }

    if (body.budget !== undefined) {
      data.budget = body.budget;
    }
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: "更新対象がありません" });
  }

  try {
    await prisma.groupMeal.update({
      where: { id: groupMealId },
      data,
    });
    const updated = await fetchGroupMeal(groupMealId);
    if (!updated) {
      return res
        .status(500)
        .json({ message: "Failed to load updated group meal" });
    }
    return res.json(buildGroupMealDetailResponse(updated, userId));
  } catch (error: any) {
    console.error("EDIT GROUP MEAL CONDITIONS ERROR:", error);
    return res.status(500).json({ message: "Failed to update group meal" });
  }
});

groupMealsRouter.patch("/:id", async (req, res) => {
  const user = req.user!;
  const userId = user.userId;
  const isAdmin = Boolean(user.isAdmin);
  const membership = isAdmin ? null : await getApprovedMembership(userId);
  if (!isAdmin && !membership) {
    return res.status(400).json(membershipRequiredResponse);
  }

  const parsedParams = idParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res
      .status(400)
      .json({
        message: "Invalid group meal id",
        issues: parsedParams.error.flatten(),
      });
  }
  const groupMealId = parsedParams.data.id;

  const parsedBody = updateGroupMealSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res
      .status(400)
      .json({ message: "Invalid body", issues: parsedBody.error.flatten() });
  }

  const groupMeal = await prisma.groupMeal.findUnique({
    where: { id: groupMealId },
  });
  if (!groupMeal) {
    return res.status(404).json({ message: "Group meal not found" });
  }
  if (!isAdmin && groupMeal.communityId !== membership!.communityId) {
    return res.status(403).json({ message: "別のコミュニティの募集です" });
  }
  if (!canManageGroupMeal({ user, groupMeal })) {
    return res.status(403).json({ message: "ホストのみ更新できます" });
  }

  let updateData: Prisma.GroupMealUpdateInput = {};
  try {
    const schedule = parsedBody.data.schedule;
    if (schedule) {
      if (schedule.date) {
        const date = parseScheduleDate(schedule.date);
        updateData.date = date;
        updateData.weekday = getWeekdayFromDate(date);
      }

      let currentTimeSlot = schedule.timeBand
        ? mapTimeBandToTimeSlot(schedule.timeBand)
        : groupMeal.timeSlot;
      if (schedule.timeBand) {
        updateData.timeSlot = mapTimeBandToTimeSlot(schedule.timeBand);
      }

      if (schedule.meetingTime !== undefined) {
        if (schedule.meetingTime === null) {
          updateData.meetingTimeMinutes = null;
        } else {
          const minutes = parseTimeToMinutes(schedule.meetingTime);
          const timeBandForValidation =
            schedule.timeBand ?? mapTimeSlotToTimeBand(currentTimeSlot);
          validateMeetingTime(minutes, timeBandForValidation);
          updateData.meetingTimeMinutes = minutes;
        }
      }

      if (schedule.place !== undefined) {
        if (schedule.place === null) {
          updateData.placeName = null;
          updateData.placeAddress = null;
          updateData.placeLatitude = null;
          updateData.placeLongitude = null;
          updateData.placeGooglePlaceId = null;
          if (parsedBody.data.meetingPlace === undefined) {
            updateData.meetingPlace = null;
          }
        } else {
          updateData.placeName = schedule.place.name;
          updateData.placeAddress = schedule.place.address ?? null;
          updateData.placeLatitude = schedule.place.latitude ?? null;
          updateData.placeLongitude = schedule.place.longitude ?? null;
          updateData.placeGooglePlaceId = schedule.place.googlePlaceId ?? null;
          updateData.meetingPlace = schedule.place.name;
        }
      }
    }

    if (parsedBody.data.meetingPlace) {
      updateData.meetingPlace = parsedBody.data.meetingPlace;
      if (updateData.placeName == null) {
        updateData.placeName = parsedBody.data.meetingPlace;
      }
    }
    if (parsedBody.data.meetUrl !== undefined) {
      if (groupMeal.mode === GroupMealMode.MEET) {
        updateData.meetUrl = parsedBody.data.meetUrl ?? null;
      }
    }
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ message: "更新対象がありません" });
  }

  try {
    const updated = await prisma.groupMeal.update({
      where: { id: groupMealId },
      data: updateData,
    });
    const [enriched] = await attachGroupMealRelations([updated]);
    if (!enriched) {
      return res
        .status(500)
        .json({ message: "Failed to load updated group meal" });
    }
    return res.json(buildGroupMealPayload(enriched, userId));
  } catch (error: any) {
    console.error("UPDATE GROUP MEAL ERROR:", error);
    return res.status(500).json({ message: "Failed to update group meal" });
  }
});

groupMealsRouter.get("/", async (req, res) => {
  const membership = req.user?.isAdmin
    ? null
    : await getApprovedMembership(req.user!.userId);
  if (!membership && !req.user?.isAdmin) {
    return res.status(400).json(membershipRequiredResponse);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  today.setUTCDate(today.getUTCDate() - 1); // include recent past a little
  const now = new Date();
  const modeParam =
    typeof req.query.mode === "string"
      ? req.query.mode.toUpperCase()
      : undefined;
  const modeFilter =
    modeParam === "REAL"
      ? GroupMealMode.REAL
      : modeParam === "MEET"
      ? GroupMealMode.MEET
      : undefined;

  try {
    let baseGroupMeals: any[];

    if (membership) {
      baseGroupMeals = (await prisma.$queryRaw`
        SELECT *
        FROM "GroupMeal"
        WHERE "communityId" = ${membership.communityId}
          AND "status"::text IN (${GroupMealStatus.OPEN}, ${GroupMealStatus.FULL})
          AND "date" >= ${today}
        ORDER BY "date" ASC, "createdAt" ASC
      `)!;
    } else {
      baseGroupMeals = (await prisma.$queryRaw`
        SELECT *
        FROM "GroupMeal"
        WHERE "status"::text IN (${GroupMealStatus.OPEN}, ${GroupMealStatus.FULL})
          AND "date" >= ${today}
        ORDER BY "date" ASC, "createdAt" ASC
      `)!;
    }

    if (modeFilter) {
      baseGroupMeals = baseGroupMeals.filter(
        (groupMeal) => groupMeal.mode === modeFilter
      );
    }

    const groupMeals = await attachGroupMealRelations(baseGroupMeals);

    return res.json(
      groupMeals.map((gm) =>
        buildGroupMealPayload(gm, req.user!.userId, { joinedOnly: true })
      )
    );
  } catch (error: any) {
    console.error("LIST GROUP MEALS ERROR:", error);
    return res.status(500).json({ message: "Failed to fetch group meals" });
  }
});

groupMealsRouter.get("/:groupMealId", async (req, res) => {
  console.log("GET /api/group-meals/:groupMealId", {
    params: req.params,
    userId: req.user?.userId,
  });

  const { groupMealId } = req.params;
  if (!groupMealId) {
    return res.status(400).json({ message: "groupMealId is required" });
  }

  const userId = req.user!.userId;
  const membership = await getApprovedMembership(userId);
  if (!membership) {
    return res.status(403).json({ message: "membership required" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const groupMeal = (await tx.groupMeal.findFirst({
        where: {
          id: groupMealId,
          communityId: membership.communityId,
        },
        include: {
          host: { include: { profile: true } },
          participants: {
            include: { user: { include: { profile: true } } },
          },
        },
      })) as GroupMealWithRelations | null;

      if (!groupMeal) {
        return null;
      }

      const [headcount, remainingCapacity] = await Promise.all([
        getGroupMealHeadcountTx(tx, groupMealId),
        getGroupMealRemainingCapacityTx(tx, groupMealId),
      ]);

      return { groupMeal, headcount, remainingCapacity };
    });

    if (!result?.groupMeal) {
      console.log("Group meal not found", {
        groupMealId,
        communityId: membership.communityId,
      });
      return res.status(404).json({ message: "Group meal not found" });
    }

    return res.json({
      ...buildGroupMealDetailResponse(result.groupMeal, userId),
      currentHeadcount: result.headcount,
      remainingCapacity: result.remainingCapacity,
    });
  } catch (error: any) {
    console.error("GET /api/group-meals/:groupMealId error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

groupMealsRouter.get("/:groupMealId/invitations", async (req, res) => {
  const membership = await getApprovedMembership(req.user!.userId);
  if (!membership) {
    return res.status(400).json(membershipRequiredResponse);
  }

  const parsedParams = groupMealIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res
      .status(400)
      .json({
        message: "Invalid group meal id",
        issues: parsedParams.error.flatten(),
      });
  }

  const groupMealId = parsedParams.data.groupMealId;
  const groupMeal = await prisma.groupMeal.findUnique({
    where: { id: groupMealId },
  });
  if (!groupMeal) {
    return res.status(404).json({ message: "Group meal not found" });
  }
  if (groupMeal.communityId !== membership.communityId) {
    return res.status(403).json({ message: "別のコミュニティの募集です" });
  }
  if (!membershipIsHost(membership, groupMeal)) {
    return res
      .status(403)
      .json({ message: "招待一覧を取得できるのはホストのみです" });
  }

  try {
    const invitations = await prisma.groupMealCandidate.findMany({
      where: { groupMealId },
      include: {
        user: { include: { profile: true } },
      },
      orderBy: { invitedAt: "asc" },
    });

    const result = invitations.map((inv) => {
      const lineStatus = inv.firstOpenedAt ? "OPENED" : "SENT_UNOPENED";
      return {
        id: inv.id,
        userId: inv.userId,
        name: inv.user.profile?.name ?? "",
        profileImageUrl: inv.user.profile?.profileImageUrl ?? null,
        favoriteMeals: inv.user.profile?.favoriteMeals ?? [],
        invitedAt: inv.invitedAt.toISOString(),
        isCanceled: inv.isCanceled,
        canceledAt: inv.canceledAt?.toISOString() ?? null,
        lineStatus,
        firstOpenedAt: inv.firstOpenedAt?.toISOString() ?? null,
        lastOpenedAt: inv.lastOpenedAt?.toISOString() ?? null,
      };
    });

    return res.json({ invitations: result });
  } catch (error: any) {
    console.error("FETCH INVITATIONS ERROR:", error);
    return res.status(500).json({ message: "Failed to fetch invitations" });
  }
});

groupMealsRouter.delete("/:id", async (req, res) => {
  const parsedParams = idParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res
      .status(400)
      .json({
        message: "Invalid group meal id",
        issues: parsedParams.error.flatten(),
      });
  }
  const groupMealId = parsedParams.data.id;
  const user = req.user!;
  const isAdmin = Boolean(user.isAdmin);
  const membership = isAdmin ? null : await getApprovedMembership(user.userId);
  if (!isAdmin && !membership) {
    return res.status(400).json(membershipRequiredResponse);
  }

  try {
    const groupMeal = await prisma.groupMeal.findUnique({
      where: { id: groupMealId },
      select: {
        id: true,
        communityId: true,
        createdByUserId: true,
      },
    });

    if (!groupMeal) {
      return res.status(404).json({ message: "Group meal not found" });
    }

    if (!isAdmin && groupMeal.communityId !== membership!.communityId) {
      return res.status(403).json({ message: "別のコミュニティの募集です" });
    }

    if (!canManageGroupMeal({ user, groupMeal })) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await prisma.$transaction([
      prisma.groupMealCandidate.deleteMany({ where: { groupMealId } }),
      prisma.groupMealParticipant.deleteMany({ where: { groupMealId } }),
      prisma.groupMeal.delete({ where: { id: groupMealId } }),
    ]);

    return res.status(204).send();
  } catch (error: any) {
    console.error("DELETE GROUP MEAL ERROR", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

groupMealsRouter.get("/:id/candidates", async (req, res) => {
  const membership = await getApprovedMembership(req.user!.userId);
  if (!membership) {
    return res.status(400).json(membershipRequiredResponse);
  }

  const parsedParams = idParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res
      .status(400)
      .json({
        message: "Invalid group meal id",
        issues: parsedParams.error.flatten(),
      });
  }
  const groupMealId = parsedParams.data.id;

  const groupMeal = await prisma.groupMeal.findUnique({
    where: { id: groupMealId },
    include: { participants: true },
  });
  if (!groupMeal) {
    return res.status(404).json({ message: "Group meal not found" });
  }
  if (!membershipIsHost(membership, groupMeal)) {
    return res
      .status(403)
      .json({ message: "招待候補を取得できるのはホストのみです" });
  }
  if (groupMeal.communityId !== membership.communityId) {
    return res.status(403).json({ message: "別のコミュニティの募集です" });
  }

  const participantIds = new Set(
    groupMeal.participants
      .filter((p: any) => isActiveParticipant(p.status))
      .map((p: any) => p.userId)
  );

  try {
    const baseCandidates = await prisma.user.findMany({
      where: {
        isAdmin: false,
        id: { notIn: Array.from(participantIds) },
        memberships: {
          some: { communityId: groupMeal.communityId, status: "approved" },
        },
      },
      include: { profile: true },
    });

    if (baseCandidates.length === 0) {
      return res.json({ candidates: [] });
    }

    const availableSlots = await prisma.availabilitySlot.findMany({
      where: {
        userId: { in: baseCandidates.map((c: any) => c.id) },
        weekday: groupMeal.weekday,
        timeSlot: groupMeal.timeSlot,
        status: AvailabilityStatus.AVAILABLE,
      },
      select: { userId: true },
    });

    const availableUserIds = new Set(availableSlots.map((s: any) => s.userId));

    const candidates = baseCandidates
      .map((u: any) => ({
        userId: u.id,
        name: u.profile?.name ?? "未設定",
        favoriteMeals: u.profile?.favoriteMeals || [],
        profileImageUrl: u.profile?.profileImageUrl ?? null,
        isAvailableForSlot: availableUserIds.has(u.id),
      }))
      .sort(
        (a, b) => Number(b.isAvailableForSlot) - Number(a.isAvailableForSlot)
      );

    return res.json({ candidates });
  } catch (error: any) {
    console.error("FETCH GROUP MEAL CANDIDATES ERROR:", error);
    return res.status(500).json({ message: "Failed to fetch candidates" });
  }
});

class InviteCapacityExceededError extends Error {
  constructor(public remaining: number) {
    super("Invite capacity exceeded");
    this.name = "InviteCapacityExceededError";
  }
}

groupMealsRouter.post("/:id/invite", async (req, res) => {
  const membership = await getApprovedMembership(req.user!.userId);
  if (!membership) {
    return res.status(400).json(membershipRequiredResponse);
  }

  const parsedParams = idParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res
      .status(400)
      .json({
        message: "Invalid group meal id",
        issues: parsedParams.error.flatten(),
      });
  }
  const groupMealId = parsedParams.data.id;

  const parsedBody = inviteSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", issues: parsedBody.error.flatten() });
  }
  const uniqueUserIds = Array.from(new Set(parsedBody.data.userIds));
  const groupMeal = await prisma.groupMeal.findUnique({
    where: { id: groupMealId },
    include: { participants: true },
  });
  if (!groupMeal) {
    return res.status(404).json({ message: "Group meal not found" });
  }
  if (!membershipIsHost(membership, groupMeal)) {
    return res.status(403).json({ message: "招待できるのはホストのみです" });
  }
  if (groupMeal.communityId !== membership.communityId) {
    return res.status(403).json({ message: "別のコミュニティの募集です" });
  }
  if (uniqueUserIds.includes(req.user!.userId)) {
    return res.status(400).json({ message: "ホスト自身は招待できません" });
  }
  const existingParticipantIds = new Set(
    groupMeal.participants.map((p: any) => p.userId)
  );
  const newParticipantIds = uniqueUserIds.filter(
    (id: any) => !existingParticipantIds.has(id)
  );

  const countedActiveParticipants = getCountedParticipantsForGroupMeal(
    groupMeal,
    ACTIVE_PARTICIPANT_STATUSES
  );
  const existingActiveIds = new Set(
    countedActiveParticipants.map((p: any) => p.userId)
  );
  const newInviteCount = uniqueUserIds.filter(
    (id: any) => !existingActiveIds.has(id)
  ).length;
  const activeCount = countedActiveParticipants.length;

  const validUsers = await prisma.user.findMany({
    where: {
      id: { in: uniqueUserIds },
      isAdmin: false,
      memberships: {
        some: { communityId: groupMeal.communityId, status: "approved" },
      },
    },
    select: { id: true },
  });
  const validUserIdSet = new Set(validUsers.map((u: any) => u.id));
  const invalidId = uniqueUserIds.find((id) => !validUserIdSet.has(id));
  if (invalidId) {
    return res
      .status(400)
      .json({
        message: "招待できないユーザーが含まれています",
        userId: invalidId,
      });
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      const txGroupMeal = await tx.groupMeal.findUnique({
        where: { id: groupMealId },
        select: {
          capacity: true,
          status: true,
          hostUserId: true,
        },
      });

      if (!txGroupMeal) {
        throw new Error("Group meal not found");
      }

      const remaining = await getGroupMealRemainingCapacityTx(tx, groupMealId);
      if (newInviteCount > remaining) {
        throw new InviteCapacityExceededError(remaining);
      }

      for (const userId of uniqueUserIds) {
        await tx.groupMealParticipant.upsert({
          where: { groupMealId_userId: { groupMealId, userId } },
          update: {
            status: GroupMealParticipantStatus.INVITED,
            isHost: false,
          },
          create: {
            groupMealId,
            userId,
            isHost: false,
            status: GroupMealParticipantStatus.INVITED,
          },
        });
        await tx.groupMealCandidate.upsert({
          where: { groupMealId_userId: { groupMealId, userId } },
          update: {
            invitedAt: new Date(),
            invitedByUserId: req.user!.userId,
            isCanceled: false,
            canceledAt: null,
            firstOpenedAt: null,
            lastOpenedAt: null,
          },
          create: {
            groupMealId,
            userId,
            invitedByUserId: req.user!.userId,
          },
        });
      }

      await syncGroupMealStatus(
        tx,
        groupMealId,
        txGroupMeal.capacity,
        txGroupMeal.status,
        txGroupMeal.hostUserId
      );
    });

    if (newParticipantIds.length > 0) {
      const usersToNotify = await prisma.user.findMany({
        where: { id: { in: newParticipantIds } },
        select: { id: true, lineUserId: true },
      });

      for (const user of usersToNotify) {
        if (!user.lineUserId) {
          console.warn("[group-meals] skip LINE invite: missing lineUserId", {
            targetUserId: user.id,
          });
          continue;
        }

        try {
          await pushGroupMealInviteNotification({
            lineUserId: user.lineUserId,
            groupMealId: groupMeal.id,
            title: groupMeal.title ?? ''
          });
        } catch (error: any) {
          console.error("[group-meals] failed to push LINE invite", {
            targetUserId: user.id,
            error,
          });
        }
      }
    }

    const updated = await fetchGroupMeal(groupMealId);
    return res.json(buildGroupMealPayload(updated!, req.user!.userId));
  } catch (error: any) {
    if (error instanceof InviteCapacityExceededError) {
      return res.status(400).json({
        message: `この箱にはあと${error.remaining}人までしか招待できません。`,
      });
    }
    console.error("INVITE GROUP MEAL CANDIDATES ERROR:", error);
    return res.status(500).json({ message: "Failed to invite candidates" });
  }
});

groupMealsRouter.post("/invitations/:invitationId/cancel", async (req, res) => {
  const parsedParams = cancelInvitationParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ message: "Invalid invitation id" });
  }

  const invitation = await prisma.groupMealCandidate.findUnique({
    where: { id: parsedParams.data.invitationId },
    include: { groupMeal: true },
  });
  if (!invitation) {
    return res.status(404).json({ message: "Invitation not found" });
  }

  const currentUserId = req.user?.userId;
  if (!currentUserId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const isOrganizer = invitation.groupMeal.hostUserId === currentUserId;
  const isInvitee = invitation.userId === currentUserId;
  const isAdmin = Boolean(req.user?.isAdmin);

  if (!isOrganizer && !isInvitee && !isAdmin) {
    return res
      .status(403)
      .json({ message: "Not allowed to cancel this invitation" });
  }

  if (invitation.isCanceled) {
    return res.status(200).json({ ok: true });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.groupMealCandidate.update({
        where: { id: invitation.id },
        data: {
          isCanceled: true,
          canceledAt: new Date(),
        },
      });
      await tx.groupMealParticipant.update({
        where: {
          groupMealId_userId: {
            groupMealId: invitation.groupMealId,
            userId: invitation.userId,
          },
        },
        data: {
          status: GroupMealParticipantStatus.CANCELLED,
        },
      });
      await syncGroupMealStatus(
        tx,
        invitation.groupMealId,
        invitation.groupMeal.capacity,
        invitation.groupMeal.status,
        invitation.groupMeal.hostUserId
      );
    });

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error("CANCEL GROUP MEAL INVITATION ERROR:", error);
    return res.status(500).json({ message: "Failed to cancel invitation" });
  }
});

groupMealsRouter.post("/invitations/:invitationId/open", async (req, res) => {
  const parsedParams = invitationIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res
      .status(400)
      .json({
        message: "Invalid invitation id",
        issues: parsedParams.error.flatten(),
      });
  }

  const invitation = await prisma.groupMealCandidate.findUnique({
    where: { id: parsedParams.data.invitationId },
  });
  if (!invitation) {
    return res.status(404).json({ message: "Invitation not found" });
  }

  if (invitation.userId !== req.user!.userId) {
    return res
      .status(403)
      .json({ message: "自分の招待のみ開封を記録できます" });
  }

  const now = new Date();
  try {
    await prisma.groupMealCandidate.update({
      where: { id: invitation.id },
      data: {
        firstOpenedAt: invitation.firstOpenedAt ?? now,
        lastOpenedAt: now,
      },
    });
    return res.status(204).send();
  } catch (error: any) {
    console.error("OPEN INVITATION ERROR:", error);
    return res
      .status(500)
      .json({ message: "Failed to update invitation status" });
  }
});

groupMealsRouter.post("/:id/respond", async (req, res) => {
  const membership = await getApprovedMembership(req.user!.userId);
  if (!membership) {
    return res.status(400).json(membershipRequiredResponse);
  }

  const parsedParams = idParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res
      .status(400)
      .json({
        message: "Invalid group meal id",
        issues: parsedParams.error.flatten(),
      });
  }
  const groupMealId = parsedParams.data.id;

  const parsedBody = respondSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", issues: parsedBody.error.flatten() });
  }

  const groupMeal = await prisma.groupMeal.findUnique({
    where: { id: groupMealId },
    include: { participants: true },
  });
  if (!groupMeal) {
    return res.status(404).json({ message: "Group meal not found" });
  }
  if (groupMeal.communityId !== membership.communityId) {
    return res.status(403).json({ message: "別のコミュニティの募集です" });
  }

  const participant = groupMeal.participants.find(
    (p) => p.userId === req.user!.userId
  );
  const countedActiveParticipants = getCountedParticipantsForGroupMeal(
    groupMeal,
    ACTIVE_PARTICIPANT_STATUSES
  );
  const activeCount = countedActiveParticipants.length;

  if (parsedBody.data.action === "ACCEPT") {
    if (participant?.isHost) {
      return res.status(400).json({ message: "ホストは常に参加者です" });
    }

    const needsSlot =
      participant && isActiveParticipant(participant.status) ? 0 : 1;
    if (activeCount + needsSlot > groupMeal.capacity) {
      return res.status(400).json({ message: "定員に空きがありません" });
    }

    try {
      await prisma.$transaction(async (tx: any) => {
        if (participant) {
          await tx.groupMealParticipant.update({
            where: {
              groupMealId_userId: { groupMealId, userId: req.user!.userId },
            },
            data: { status: GroupMealParticipantStatus.JOINED },
          });
        } else {
          await tx.groupMealParticipant.create({
            data: {
              groupMealId,
              userId: req.user!.userId,
              isHost: false,
              status: GroupMealParticipantStatus.JOINED,
            },
          });
        }

        await syncGroupMealStatus(
          tx,
          groupMealId,
          groupMeal.capacity,
          groupMeal.status,
          groupMeal.hostUserId
        );
      });

      const updated = await fetchGroupMeal(groupMealId);
      return res.json(buildGroupMealPayload(updated!, req.user!.userId));
    } catch (error: any) {
      console.error("RESPOND GROUP MEAL ACCEPT ERROR:", error);
      return res.status(500).json({ message: "Failed to accept invitation" });
    }
  }

  // DECLINE
  if (!participant) {
    return res.status(404).json({ message: "招待されていない募集です" });
  }
  if (participant.isHost) {
    return res.status(400).json({ message: "ホストは辞退できません" });
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      await tx.groupMealParticipant.update({
        where: {
          groupMealId_userId: { groupMealId, userId: req.user!.userId },
        },
        data: { status: GroupMealParticipantStatus.DECLINED },
      });

      await syncGroupMealStatus(
        tx,
        groupMealId,
        groupMeal.capacity,
        groupMeal.status,
        groupMeal.hostUserId
      );
    });

    const updated = await fetchGroupMeal(groupMealId);
    return res.json(buildGroupMealPayload(updated!, req.user!.userId));
  } catch (error: any) {
    console.error("RESPOND GROUP MEAL DECLINE ERROR:", error);
    return res.status(500).json({ message: "Failed to decline invitation" });
  }
});

groupMealsRouter.patch("/:groupMealId/participant/status", async (req, res) => {
  const membership = await getApprovedMembership(req.user!.userId);
  if (!membership) {
    return res.status(400).json(membershipRequiredResponse);
  }

  const parsedParams = groupMealIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res
      .status(400)
      .json({
        message: "Invalid group meal id",
        issues: parsedParams.error.flatten(),
      });
  }
  const groupMealId = parsedParams.data.groupMealId;

  const parsedBody = updateParticipantStatusSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res
      .status(400)
      .json({ message: "Invalid body", issues: parsedBody.error.flatten() });
  }

  const groupMeal = await prisma.groupMeal.findUnique({
    where: { id: groupMealId },
    include: { participants: true },
  });

  if (!groupMeal) {
    return res.status(404).json({ message: "Group meal not found" });
  }

  if (groupMeal.communityId !== membership.communityId) {
    return res.status(403).json({ message: "別のコミュニティの募集です" });
  }

  const participant = groupMeal.participants.find(
    (p) => p.userId === req.user!.userId
  );
  if (!participant) {
    return res
      .status(404)
      .json({ message: "参加メンバーとして登録されていません" });
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      await tx.groupMealParticipant.update({
        where: { id: participant.id },
        data: { status: parsedBody.data.status as GroupMealParticipantStatus },
      });
      await syncGroupMealStatus(
        tx,
        groupMeal.id,
        groupMeal.capacity,
        groupMeal.status,
        groupMeal.hostUserId
      );
    });

    const updated = await fetchGroupMeal(groupMealId);
    return res.json(buildGroupMealPayload(updated!, req.user!.userId));
  } catch (error: any) {
    console.error("UPDATE PARTICIPANT STATUS ERROR:", error);
    return res
      .status(500)
      .json({ message: "Failed to update participant status" });
  }
});

groupMealsRouter.post("/:id/join", async (req, res) => {
  const membership = await getApprovedMembership(req.user!.userId);
  if (!membership) {
    return res.status(400).json(membershipRequiredResponse);
  }

  const parsedParams = idParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res
      .status(400)
      .json({
        message: "Invalid group meal id",
        issues: parsedParams.error.flatten(),
      });
  }
  const groupMealId = parsedParams.data.id;

  const groupMeal = await prisma.groupMeal.findUnique({
    where: { id: groupMealId },
    include: { participants: true },
  });
  if (!groupMeal) {
    return res.status(404).json({ message: "Group meal not found" });
  }
  if (groupMeal.communityId !== membership.communityId) {
    return res.status(403).json({ message: "別のコミュニティの募集です" });
  }
  if (groupMeal.hostUserId === req.user!.userId) {
    return res.status(400).json({ message: "ホストは既に参加済みです" });
  }

  const participant = groupMeal.participants.find(
    (p) => p.userId === req.user!.userId
  );
  if (participant && isActiveParticipant(participant.status)) {
    return res.status(400).json({ message: "既に参加または招待済みです" });
  }

  const activeCount = getCountedParticipantsForGroupMeal(
    groupMeal,
    ACTIVE_PARTICIPANT_STATUSES
  ).length;
  if (activeCount + 1 > groupMeal.capacity) {
    return res.status(400).json({ message: "定員に空きがありません" });
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      if (participant) {
        await tx.groupMealParticipant.update({
          where: {
            groupMealId_userId: { groupMealId, userId: req.user!.userId },
          },
          data: { status: GroupMealParticipantStatus.JOINED },
        });
      } else {
        await tx.groupMealParticipant.create({
          data: {
            groupMealId,
            userId: req.user!.userId,
            isHost: false,
            status: GroupMealParticipantStatus.JOINED,
          },
        });
      }

      await syncGroupMealStatus(
        tx,
        groupMealId,
        groupMeal.capacity,
        groupMeal.status,
        groupMeal.hostUserId
      );
    });

    const updated = await fetchGroupMeal(groupMealId);
    return res.json(buildGroupMealPayload(updated!, req.user!.userId));
  } catch (error: any) {
    console.error("JOIN GROUP MEAL ERROR:", error);
    return res.status(500).json({ message: "Failed to join group meal" });
  }
});

groupMealsRouter.post("/:id/leave", async (req, res) => {
  // 1. パラメータ検証
  const parsedParams = idParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res
      .status(400)
      .json({
        message: "Invalid group meal id",
        issues: parsedParams.error.flatten(),
      });
  }
  const groupMealId = parsedParams.data.id;

  // 2. 一般ユーザーは membership 必須（admin は middleware で既にブロックされる前提）
  const membership = await getApprovedMembership(req.user!.userId);
  if (!membership) {
    return res.status(400).json(membershipRequiredResponse);
  }

  try {
    // 3. 対象のグループを取得（参加者付き）
    const groupMeal = await prisma.groupMeal.findUnique({
      where: { id: groupMealId },
      include: { participants: true },
    });

    if (!groupMeal) {
      return res.status(404).json({ message: "Group meal not found" });
    }

    // 4. コミュニティ一致チェック
    if (groupMeal.communityId !== membership.communityId) {
      return res.status(403).json({ message: "別のコミュニティの募集です" });
    }

    // 5. 自分の参加情報を探す
    const participant = groupMeal.participants.find(
      (p) => p.userId === req.user!.userId
    );

    if (!participant) {
      return res.status(400).json({ message: "この募集には参加していません" });
    }

    if (participant.isHost) {
      return res
        .status(400)
        .json({ message: "ホストは退会できません。箱を削除してください。" });
    }

    if (!ATTENDING_PARTICIPANT_STATUSES.includes(participant.status)) {
      // INVITED や DECLINED/CANCELLED の場合は「参加中ではない」とみなす
      return res.status(400).json({ message: "参加中の募集ではありません" });
    }

    // 6. トランザクション内でステータス更新 & 定員ステータス同期
    await prisma.$transaction(async (tx: any) => {
      await tx.groupMealParticipant.update({
        where: {
          groupMealId_userId: {
            groupMealId,
            userId: req.user!.userId,
          },
        },
        data: {
          status: GroupMealParticipantStatus.CANCELLED,
      },
    });

    await syncGroupMealStatus(
      tx,
      groupMealId,
      groupMeal.capacity,
      groupMeal.status,
      groupMeal.hostUserId
    );
    });

    const updated = await fetchGroupMeal(groupMealId);
    return res.json(buildGroupMealPayload(updated!, req.user!.userId));
  } catch (error: any) {
    console.error("LEAVE GROUP MEAL ERROR:", error);
    return res.status(500).json({ message: "Failed to leave group meal" });
  }
});

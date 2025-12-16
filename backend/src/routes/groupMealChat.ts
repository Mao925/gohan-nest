import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  assertCanAccessGroupMealChat,
  GroupMealChatAccessError,
} from '../utils/groupMealChat.js';

const groupMealIdParamsSchema = z.object({
  groupMealId: z.string().uuid(),
});

const messagesQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const sendMessageBodySchema = z.object({
  text: z.string().trim().min(1).max(1000),
});

const DEFAULT_MESSAGE_LIMIT = 30;
const MAX_MESSAGE_LIMIT = 100;

const groupMealChatRouter = Router({ mergeParams: true });
groupMealChatRouter.use(authMiddleware);

type SerializedMessage = {
  id: string;
  text: string;
  createdAt: string;
  sender: {
    id: string;
    displayName: string;
    avatarUrl?: string;
  };
};

function formatSender(user: {
  id: string;
  profile: { name?: string | null; profileImageUrl?: string | null } | null;
  lineDisplayName?: string | null;
}) {
  const nameFromProfile = user.profile?.name?.trim();
  const displayName =
    nameFromProfile && nameFromProfile.length > 0
      ? nameFromProfile
      : user.lineDisplayName?.trim() || 'GoMeal Member';

  const senderPayload: SerializedMessage['sender'] = {
    id: user.id,
    displayName,
  };

  if (user.profile?.profileImageUrl) {
    senderPayload.avatarUrl = user.profile.profileImageUrl;
  }

  return senderPayload;
}

function formatMessage(message: {
  id: string;
  text: string;
  createdAt: Date;
  sender: Parameters<typeof formatSender>[0];
}): SerializedMessage {
  return {
    id: message.id,
    text: message.text,
    createdAt: message.createdAt.toISOString(),
    sender: formatSender(message.sender),
  };
}

async function enforceChatAccess(userId: string, groupMealId: string) {
  await assertCanAccessGroupMealChat(userId, groupMealId);
}

function handleAccessError(res: Response, error: unknown) {
  if (error instanceof GroupMealChatAccessError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error('[group-meal-chat] unexpected access check error', error);
  return res.status(500).json({ message: 'Failed to verify access' });
}

groupMealChatRouter.get('/messages', async (req: Request, res: Response) => {
  const params = groupMealIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res
      .status(400)
      .json({ message: 'Invalid group meal id', issues: params.error.format() });
  }

  const query = messagesQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res
      .status(400)
      .json({ message: 'Invalid query', issues: query.error.format() });
  }

  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    await enforceChatAccess(req.user.userId, params.data.groupMealId);
  } catch (error) {
    return handleAccessError(res, error);
  }

  const limit = Math.min(
    query.data.limit ?? DEFAULT_MESSAGE_LIMIT,
    MAX_MESSAGE_LIMIT
  );
  const take = limit + 1;
  const { groupMealId } = params.data;

  if (query.data.cursor) {
    const cursorRecord = await prisma.groupMealChatMessage.findFirst({
      where: { id: query.data.cursor },
      select: { groupMealId: true },
    });
    if (!cursorRecord || cursorRecord.groupMealId !== groupMealId) {
      return res.status(400).json({ message: 'Invalid cursor' });
    }
  }

  const rowSet = await prisma.groupMealChatMessage.findMany({
    where: { groupMealId },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    take,
    include: {
      sender: {
        include: { profile: true },
      },
    },
    ...(query.data.cursor
      ? { cursor: { id: query.data.cursor }, skip: 1 }
      : {}),
  });

  const hasNext = rowSet.length > limit;
  const page = hasNext ? rowSet.slice(0, limit) : rowSet;

  let nextCursor: string | undefined;
  if (hasNext && rowSet[limit - 1]) {
    nextCursor = rowSet[limit - 1].id;
  }

  const messages = page.reverse().map(formatMessage);

  const responseBody: { messages: SerializedMessage[]; nextCursor?: string } = {
    messages,
  };
  if (nextCursor) {
    responseBody.nextCursor = nextCursor;
  }

  return res.json(responseBody);
});

groupMealChatRouter.post('/messages', async (req: Request, res: Response) => {
  const params = groupMealIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res
      .status(400)
      .json({ message: 'Invalid group meal id', issues: params.error.format() });
  }

  const body = sendMessageBodySchema.safeParse(req.body);
  if (!body.success) {
    return res
      .status(400)
      .json({ message: 'Invalid body', issues: body.error.format() });
  }

  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    await enforceChatAccess(req.user.userId, params.data.groupMealId);
  } catch (error) {
    return handleAccessError(res, error);
  }

  try {
    const created = await prisma.groupMealChatMessage.create({
      data: {
        groupMealId: params.data.groupMealId,
        senderUserId: req.user.userId,
        text: body.data.text,
      },
      include: {
        sender: {
          include: { profile: true },
        },
      },
    });

    return res.status(201).json(formatMessage(created));
  } catch (error) {
    console.error('[group-meal-chat] failed to create message', error);
    return res.status(500).json({ message: 'Failed to send message' });
  }
});

export { groupMealChatRouter };

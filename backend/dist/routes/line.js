import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { DEFAULT_COMMUNITY_CODE, ENABLE_LINE_DAILY_AVAILABILITY_PUSH, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN } from '../config.js';
import { pushAvailabilityMessage } from '../lib/lineMessages.js';
const lineRouter = Router();
function sendLunchAvailabilityMessage(lineUserId) {
    return pushAvailabilityMessage(lineUserId, 'DAY');
}
lineRouter.post('/daily-availability-push', async (_req, res) => {
    if (!ENABLE_LINE_DAILY_AVAILABILITY_PUSH) {
        console.log('[line-daily-push] disabled via ENABLE_LINE_DAILY_AVAILABILITY_PUSH=false');
        return res.status(204).send();
    }
    if (!LINE_MESSAGING_CHANNEL_ACCESS_TOKEN) {
        console.error('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not configured');
        return res.status(500).json({ message: 'LINE channel access token is not configured' });
    }
    const community = await prisma.community.findUnique({
        where: { inviteCode: DEFAULT_COMMUNITY_CODE }
    });
    if (!community) {
        console.error('KING community not found');
        return res.status(500).json({ message: 'KING community not found' });
    }
    const memberships = await prisma.communityMembership.findMany({
        where: {
            communityId: community.id,
            status: 'approved',
            user: { lineUserId: { not: null } }
        },
        include: { user: { select: { id: true, lineUserId: true } } }
    });
    let sent = 0;
    for (const membership of memberships) {
        if (!membership.user.lineUserId) {
            continue;
        }
        const success = await sendLunchAvailabilityMessage(membership.user.lineUserId);
        if (success) {
            sent += 1;
        }
    }
    return res.json({ sent, target: memberships.length });
});
export { lineRouter };

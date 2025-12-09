import test from 'node:test';
import assert from 'node:assert/strict';
import { GroupMealParticipantStatus } from '@prisma/client';
import { getCountedParticipantsForGroupMeal } from '../../utils/groupMealParticipants.js';
test('counts the creator when they occupy a seat', () => {
    const counted = getCountedParticipantsForGroupMeal({
        hostUserId: 'user-creator',
        participants: [
            {
                userId: 'user-creator',
                status: GroupMealParticipantStatus.JOINED,
                isCreator: true,
            },
        ],
    });
    assert.equal(counted.length, 1);
    assert.equal(counted[0].userId, 'user-creator');
});
test('excludes the host when they are not flagged as the creator', () => {
    const counted = getCountedParticipantsForGroupMeal({
        hostUserId: 'admin-host',
        participants: [
            {
                userId: 'admin-host',
                status: GroupMealParticipantStatus.JOINED,
                isCreator: false,
            },
            {
                userId: 'guest',
                status: GroupMealParticipantStatus.JOINED,
                isCreator: false,
            },
        ],
    });
    assert.equal(counted.length, 1);
    assert.equal(counted[0].userId, 'guest');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRelationshipResponse, buildRelationshipPayload, formatPartnerAnswer } from '../relationships.js';

const baseDate = new Date('2024-01-01T00:00:00.000Z');

const matchSample = {
  id: 'match-1',
  user1Id: 'me',
  user2Id: 'partner-1',
  communityId: 'community',
  createdAt: baseDate,
  user1: {
    id: 'me',
    profile: { name: '自分', favoriteMeals: ['ラーメン'], profileImageUrl: null }
  },
  user2: {
    id: 'partner-1',
    profile: { name: 'Partner One', favoriteMeals: ['餃子'], profileImageUrl: 'https://example.com/p1.png' }
  }
};

const awaitingLike = {
  id: 'like-yes',
  fromUserId: 'me',
  toUserId: 'awaiting',
  communityId: 'community',
  answer: 'YES' as const,
  createdAt: baseDate,
  toUser: {
    id: 'awaiting',
    profile: { name: 'Awaiting User', favoriteMeals: [], profileImageUrl: null }
  }
};

const rejectedLike = {
  id: 'like-no',
  fromUserId: 'me',
  toUserId: 'rejected',
  communityId: 'community',
  answer: 'NO' as const,
  createdAt: baseDate,
  toUser: {
    id: 'rejected',
    profile: { name: 'Rejected User', favoriteMeals: [], profileImageUrl: null }
  }
};

test('buildRelationshipResponse ensures id for every section', () => {
  const response = buildRelationshipResponse({
    userId: 'me',
    matches: [matchSample],
    likesFrom: [awaitingLike, rejectedLike],
    reverseLikes: [
      {
        id: 'rev-1',
        fromUserId: 'awaiting',
        toUserId: 'me',
        communityId: 'community',
        answer: 'NO',
        createdAt: baseDate
      }
    ] as any
  });

  assert.equal(response.matches.at(0)?.id, 'match-1');
  assert.equal(response.matches.at(0)?.targetUserId, 'partner-1');
  assert.equal(response.awaitingResponse.at(0)?.id, 'like-yes');
  assert.equal(response.awaitingResponse.at(0)?.targetUserId, 'awaiting');
  assert.equal(response.rejected.at(0)?.id, 'like-no');
  assert.equal(response.rejected.at(0)?.targetUserId, 'rejected');
});

test('buildRelationshipPayload uses match id when matched, like id otherwise', () => {
  const payloadWhenMatched = buildRelationshipPayload({
    like: awaitingLike,
    myAnswer: 'YES',
    partnerAnswer: formatPartnerAnswer('YES'),
    matchRecord: { id: 'match-xyz', createdAt: baseDate }
  });
  assert.equal(payloadWhenMatched.relationship.id, 'match-xyz');
  assert.equal(payloadWhenMatched.relationship.targetUserId, 'awaiting');
  assert.equal(payloadWhenMatched.nextSection, 'matches');

  const payloadWhenRejected = buildRelationshipPayload({
    like: rejectedLike,
    myAnswer: 'NO',
    partnerAnswer: formatPartnerAnswer(),
    matchRecord: null
  });
  assert.equal(payloadWhenRejected.relationship.id, 'like-no');
  assert.equal(payloadWhenRejected.relationship.targetUserId, 'rejected');
  assert.equal(payloadWhenRejected.nextSection, 'rejected');
});

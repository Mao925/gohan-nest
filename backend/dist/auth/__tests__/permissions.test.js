import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageGroupMeal } from '../permissions.js';
const adminUser = {
    userId: 'admin-user',
    email: 'admin@example.com',
    isAdmin: true,
};
const generalUser = {
    userId: 'general-user',
    email: 'user@example.com',
    isAdmin: false,
};
test('admin users always have manage rights', () => {
    const groupMeal = { createdByUserId: 'someone-else' };
    assert.ok(canManageGroupMeal({ user: adminUser, groupMeal }));
});
test('creator can manage their own group meal', () => {
    const groupMeal = { createdByUserId: generalUser.userId };
    assert.ok(canManageGroupMeal({ user: generalUser, groupMeal }));
});
test('non-creator general user cannot manage other group meals', () => {
    const groupMeal = { createdByUserId: 'someone-else' };
    assert.ok(!canManageGroupMeal({ user: generalUser, groupMeal }));
});
test('null creator means only admin can manage', () => {
    const groupMeal = { createdByUserId: null };
    assert.ok(!canManageGroupMeal({ user: generalUser, groupMeal }));
});

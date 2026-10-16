import test from "node:test";
import assert from "node:assert";

export const describe = (name, fn) => test.describe(name, fn);
export const it = (name, fn) => test.it(name, fn);
export { it as test };
export const beforeEach = (fn) => test.beforeEach(fn);
export const afterEach = (fn) => test.afterEach(fn);
export const beforeAll = (fn) => test.before(fn);
export const afterAll = (fn) => test.after(fn);

export function expect(actual) {
  return {
    toBe(expected) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected) {
      assert.deepStrictEqual(actual, expected);
    },
    toHaveLength(len) {
      assert.strictEqual(actual.length, len);
    },
    toBeNull() {
      assert.strictEqual(actual, null);
    },
    not: {
      toBe(expected) {
        assert.notStrictEqual(actual, expected);
      },
      toEqual(expected) {
        assert.notDeepStrictEqual(actual, expected);
      },
      toBeNull() {
        assert.notStrictEqual(actual, null);
      },
    },
    toBeGreaterThan(expected) {
      assert.ok(actual > expected, `Expected ${actual} > ${expected}`);
    },
    toBeGreaterThanOrEqual(expected) {
      assert.ok(actual >= expected, `Expected ${actual} >= ${expected}`);
    },
    toBeLessThan(expected) {
      assert.ok(actual < expected, `Expected ${actual} < ${expected}`);
    },
    toBeLessThanOrEqual(expected) {
      assert.ok(actual <= expected, `Expected ${actual} <= ${expected}`);
    },
    toBeTruthy() {
      assert.ok(actual);
    },
    toBeFalsy() {
      assert.ok(!actual);
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined);
    },
    toBeUndefined() {
      assert.strictEqual(actual, undefined);
    },
    toContain(item) {
      if (Array.isArray(actual) || typeof actual === "string") {
        assert.ok(actual.includes(item), `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`);
      } else {
        assert.ok(item in actual, `Expected key ${item} in object`);
      }
    },
  };
}

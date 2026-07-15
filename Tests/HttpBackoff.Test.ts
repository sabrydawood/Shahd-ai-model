import { test, expect } from "bun:test";
import { FetchWithBackoff, CircuitBreaker, HttpError, RetryAfterToMs, IsTransient } from "../Foundry/HttpBackoff.ts";

const NoSleep = async (): Promise<void> => {}; // never really wait in tests

test("FetchWithBackoff retries a transient failure then succeeds", async () => {
  let Calls = 0;
  const Result = await FetchWithBackoff(
    async () => {
      Calls++;
      if (Calls < 3) throw new HttpError(429); // rate-limited twice
      return "ok";
    },
    { Sleep: NoSleep },
  );
  expect(Result).toBe("ok");
  expect(Calls).toBe(3); // two retries, third succeeds
});

test("FetchWithBackoff honors a server Retry-After hint for the delay", async () => {
  const Delays: number[] = [];
  let Calls = 0;
  await FetchWithBackoff(
    async () => {
      Calls++;
      if (Calls === 1) throw new HttpError(429, 1234); // server says wait 1234ms
      return "ok";
    },
    { Sleep: async (Ms) => { Delays.push(Ms); } },
  );
  expect(Delays).toEqual([1234]); // used the hint, not the exponential default
});

test("FetchWithBackoff does NOT retry a non-transient error (404) and gives up after MaxAttempts", async () => {
  let Calls = 0;
  await expect(
    FetchWithBackoff(async () => { Calls++; throw new HttpError(404); }, { Sleep: NoSleep }),
  ).rejects.toThrow("HTTP 404");
  expect(Calls).toBe(1); // 404 is a real client error — not retried

  let Calls2 = 0;
  await expect(
    FetchWithBackoff(async () => { Calls2++; throw new HttpError(500); }, { Sleep: NoSleep, MaxAttempts: 3 }),
  ).rejects.toThrow("HTTP 500");
  expect(Calls2).toBe(3); // 5xx is transient — retried up to the cap, then rethrown
});

test("IsTransient classifies statuses correctly", () => {
  expect(IsTransient(new HttpError(429))).toBe(true);
  expect(IsTransient(new HttpError(503))).toBe(true);
  expect(IsTransient(new HttpError(404))).toBe(false);
  expect(IsTransient(new HttpError(400))).toBe(false);
  expect(IsTransient(new Error("socket hang up"))).toBe(true); // network error
});

test("RetryAfterToMs parses seconds, rejects garbage", () => {
  expect(RetryAfterToMs("5")).toBe(5000);
  expect(RetryAfterToMs("0")).toBe(0);
  expect(RetryAfterToMs(null)).toBeNull();
  expect(RetryAfterToMs("soon")).toBeNull();
});

test("CircuitBreaker trips after K consecutive failures; a success resets it", () => {
  const B = new CircuitBreaker(3);
  expect(B.Fail()).toBe(false); // 1
  expect(B.Fail()).toBe(false); // 2
  B.Success(); // reset
  expect(B.Fail()).toBe(false); // 1
  expect(B.Fail()).toBe(false); // 2
  expect(B.Fail()).toBe(true); // 3 -> tripped
  expect(B.Tripped).toBe(true);
});

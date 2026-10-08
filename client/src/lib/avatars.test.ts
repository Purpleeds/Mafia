import { describe, expect, it } from "vitest";
import { migrateAvatar, randomAvatar } from "./avatars";

describe("migrateAvatar", () => {
  it("keeps a valid avatar", () => {
    expect(migrateAvatar({ color: "teal", seed: "abc123" })).toEqual({ color: "teal", seed: "abc123" });
  });

  it("turns an older emoji-icon avatar into a seeded look", () => {
    expect(migrateAvatar({ color: "red", icon: "fox" })).toEqual({ color: "red", seed: "fox" });
  });

  it("drops anything it can't use", () => {
    expect(migrateAvatar(null)).toBeNull();
    expect(migrateAvatar("teal")).toBeNull();
    expect(migrateAvatar({ color: "plaid", seed: "abc" })).toBeNull();
    expect(migrateAvatar({ color: "teal", seed: "Has Spaces" })).toBeNull();
    expect(migrateAvatar({ color: "teal" })).toBeNull();
  });
});

describe("randomAvatar", () => {
  it("is always valid", () => {
    for (let i = 0; i < 20; i++) expect(migrateAvatar(randomAvatar())).not.toBeNull();
  });
});

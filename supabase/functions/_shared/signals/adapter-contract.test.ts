import { type ContractScenario, registerAdapterContract } from "./adapter-contract.ts";
import { FAKE_GUEST_WORDS, FAKE_IDS, FAKE_NOW, FakePms, fakeWebhookBody, fakeWorld } from "./fake-pms.ts";
import {
  type FakeHostawayWorld,
  HOSTAWAY_GUEST_WORDS,
  hostawayAdapterOn,
  hostawayConversation,
  hostawayMessage,
  hostawayMessageWebhook,
  hostawayReview,
} from "./hostaway-fake-api.ts";

// One contract, two adapters: the PMS in memory and Hostaway's adapter over
// a synthetic network in the live API's shape. Synthetic data only.

const SINCE = new Date("2026-10-13T00:00:00Z");

/** A synchronous call as a promise: what it throws becomes a rejection. */
function rejection(call: () => unknown): Promise<unknown> {
  return new Promise((resolve) => resolve(call()));
}
const REVIEW_WINDOW = { since: new Date("2026-10-12T06:00:00Z"), until: new Date("2026-10-15T12:00:00Z") };

// ------------------------------------------------------------- fake PMS

registerAdapterContract({
  name: "fake PMS",
  setUp(): ContractScenario {
    const adapter = new FakePms(fakeWorld());
    const ids = FAKE_IDS;
    const stay = fakeWorld().conversations.find((c) => c.id === ids.stay);
    const guest = stay?.messages.find((m) => m.externalId === ids.guest);
    if (guest === undefined) {
      throw new Error("The fake world lost its guest's message");
    }
    const malformed = { fake: "message.created", message: { text: "FAKE-GUEST-TEXT without its ids" } };
    const failing = (failures: Parameters<typeof fakeWorld>[0]) => new FakePms(fakeWorld(failures));
    return {
      adapter,
      guestWords: FAKE_GUEST_WORDS,
      reviews: { window: { since: SINCE, until: FAKE_NOW }, ids: ["fake-review-1", "fake-review-2"], skipped: 1 },
      activeConversations: {
        since: SINCE,
        ids: [ids.stay, ids.noBooking, ids.room, ids.missedWebhook, ids.limited],
      },
      conversation: {
        id: ids.stay,
        since: SINCE,
        guestIds: [ids.guest],
        hostIds: [ids.host],
        automatedIds: [ids.automated],
        emptyIds: [ids.empty],
        attachmentOnlyIds: [ids.attachment],
        olderIds: [ids.older],
      },
      conversationWithoutBooking: { id: ids.noBooking, since: SINCE },
      webhook: {
        body: fakeWebhookBody(guest),
        externalId: ids.guest,
        externalConversationId: ids.stay,
        others: [{ fake: "booking.created" }, null, "message", []],
        malformed,
      },
      bookings: {
        named: "fake-booking-1",
        nameless: "fake-booking-nameless",
        gone: "fake-booking-deleted",
        unavailable: "fake-booking-down",
        room: { id: "fake-booking-room", unitId: "fake-room-7" },
      },
      failures: [
        { label: "a rate limit", code: "rate_limited", run: () => adapter.fetchConversation(ids.limited, SINCE) },
        {
          label: "the PMS down",
          code: "unavailable",
          run: () => failing({ failures: { fetchReviews: "unavailable" } }).fetchReviews(REVIEW_WINDOW),
        },
        {
          label: "credentials refused",
          code: "auth",
          run: () => failing({ failures: { listActiveConversations: "auth" } }).listActiveConversations(SINCE),
        },
        {
          label: "a filter the PMS ignored",
          code: "filter_ignored",
          run: () => failing({ failures: { fetchConversation: "filter_ignored" } }).fetchConversation(ids.stay, SINCE),
        },
        {
          label: "a broken notification",
          code: "bad_row",
          run: () => rejection(() => adapter.parseWebhook({ headers: new Headers(), body: malformed })),
        },
      ],
    };
  },
});

// -------------------------------------------------------------- Hostaway

const PAGES = { reviewsPageSize: 2, conversationsPageSize: 2, messagesPageSize: 2 };

function hostawayWorld(): FakeHostawayWorld {
  return {
    reviews: [
      hostawayReview({ id: 90000001, submittedAt: "2026-10-12 08:00:00" }),
      // Not yet published: Hostaway keeps a row for every stay long before the guest writes.
      hostawayReview({ id: 90000002, status: "awaiting", submittedAt: "2026-10-13 08:00:00" }),
      // Broken: no listing. Counted, never kept.
      hostawayReview({ id: 90000003, listingMapId: null, submittedAt: "2026-10-14 08:00:00" }),
      hostawayReview({ id: 90000004, reservationId: null, submittedAt: "2026-10-14 09:00:00" }),
      hostawayReview({ id: 90000005, submittedAt: "2026-10-15 13:00:00" }),
    ],
    conversations: [
      hostawayConversation(70000001, "2026-10-15 10:00:00"),
      // Only the host has written: no guest message to read.
      hostawayConversation(70000002, null),
      hostawayConversation(70000003, "2026-10-15 08:00:00", { reservationId: null }),
      hostawayConversation(70000004, "2026-10-14 09:00:00"),
      // Older than the window: the list ends here, the next page is never asked.
      hostawayConversation(70000005, "2026-10-10 09:00:00"),
      hostawayConversation(70000006, "2026-10-09 09:00:00"),
    ],
    messages: {
      // Out of order, as the PMS may send them.
      "70000001": [
        hostawayMessage(60000002, 70000001, "2026-10-14 08:30:00", {
          isIncoming: 0,
          userId: 5,
          body: "We are sending a technician.",
        }),
        hostawayMessage(60000001, 70000001, "2026-10-14 08:00:00"),
        hostawayMessage(60000003, 70000001, "2026-10-13 12:00:00", {
          isIncoming: 0,
          communicationId: 99,
          communicationEvent: "arrival",
          body: "Your check-in details.",
        }),
        hostawayMessage(60000004, 70000001, "2026-10-14 09:00:00", { body: "" }),
        hostawayMessage(60000005, 70000001, "2026-10-14 09:05:00", {
          body: null,
          attachments: [{ url: "https://files.invalid/a.jpg" }],
          imagesUrls: ["https://files.invalid/b.jpg"],
        }),
        hostawayMessage(60000006, 70000001, "2026-10-12 08:00:00"),
      ],
      "70000003": [hostawayMessage(60000010, 70000003, "2026-10-15 08:00:00", { reservationId: null })],
      "70000009": [{ body: "SYNTH-GUEST-TEXT: a message without its ids", isIncoming: 1 }],
      "70000007": [hostawayMessage(60000020, 70000008, "2026-10-14 08:00:00")],
    },
    reservations: {
      "80000001": {
        id: 80000001,
        guestName: "Synthia Booker",
        guestFirstName: "Synthia",
        guestLastName: "Booker",
        reservationUnit: [],
      },
      "80000002": { id: 80000002, reservationUnit: [] },
      "80000005": { id: 80000005, guestName: "Synthia Booker", reservationUnit: [{ listingUnitId: 61011 }] },
    },
    failures: {
      "conversations/70000004/messages": { status: 429 },
      "reservations/80000004": { status: 500 },
    },
  };
}

registerAdapterContract({
  name: "Hostaway",
  setUp(): ContractScenario {
    const world = hostawayWorld();
    const { adapter } = hostawayAdapterOn(world, PAGES);
    const on = (changes: Partial<FakeHostawayWorld>) => hostawayAdapterOn({ ...world, ...changes }, PAGES).adapter;
    const malformed = hostawayMessageWebhook({ body: "SYNTH-GUEST-TEXT: a notification without ids", isIncoming: 1 });
    return {
      adapter,
      guestWords: HOSTAWAY_GUEST_WORDS,
      reviews: { window: REVIEW_WINDOW, ids: ["90000001", "90000004"], skipped: 1 },
      activeConversations: { since: SINCE, ids: ["70000001", "70000003", "70000004"] },
      conversation: {
        id: "70000001",
        since: SINCE,
        guestIds: ["60000001"],
        hostIds: ["60000002"],
        automatedIds: ["60000003"],
        emptyIds: ["60000004"],
        attachmentOnlyIds: ["60000005"],
        olderIds: ["60000006"],
      },
      conversationWithoutBooking: { id: "70000003", since: SINCE },
      webhook: {
        body: hostawayMessageWebhook(hostawayMessage(60000001, 70000001, "2026-10-14 08:00:00")),
        externalId: "60000001",
        externalConversationId: "70000001",
        others: [
          { object: "reservation", event: "reservation.updated", data: { id: 80000001 } },
          { object: "task", event: "task.created", data: { id: 1 } },
          null,
          "message.received",
          [],
        ],
        malformed,
      },
      bookings: {
        named: "80000001",
        nameless: "80000002",
        gone: "80000003",
        unavailable: "80000004",
        room: { id: "80000005", unitId: "61011" },
      },
      failures: [
        { label: "a rate limit", code: "rate_limited", run: () => adapter.fetchConversation("70000004", SINCE) },
        {
          label: "Hostaway down",
          code: "unavailable",
          run: () => on({ failures: { reviews: { status: 503 } } }).fetchReviews(REVIEW_WINDOW),
        },
        {
          label: "a refusal quoting a guest's words",
          code: "unavailable",
          run: () =>
            on({ failures: { reviews: { refusal: "SYNTH-GUEST-TEXT from Synthia Booker" } } }).fetchReviews(
              REVIEW_WINDOW,
            ),
        },
        {
          label: "credentials refused",
          code: "auth",
          run: () => on({ authStatus: 401 }).listActiveConversations(SINCE),
        },
        {
          label: "reviews outside the asked window",
          code: "filter_ignored",
          run: () => on({ reviews: [hostawayReview({ submittedAt: "2026-09-01 08:00:00" })] }).fetchReviews(REVIEW_WINDOW),
        },
        {
          label: "a list not newest first",
          code: "filter_ignored",
          run: () =>
            on({
              conversations: [
                hostawayConversation(1, "2026-10-14 08:00:00"),
                hostawayConversation(2, "2026-10-15 08:00:00"),
              ],
            }).listActiveConversations(SINCE),
        },
        {
          label: "a message of another conversation",
          code: "filter_ignored",
          run: () => adapter.fetchConversation("70000007", SINCE),
        },
        {
          label: "a message without its ids",
          code: "bad_row",
          run: () => adapter.fetchConversation("70000009", SINCE),
        },
        { label: "not a Hostaway id", code: "bad_row", run: () => adapter.fetchConversation("abc", SINCE) },
        {
          label: "a broken notification",
          code: "bad_row",
          run: () => rejection(() => adapter.parseWebhook({ headers: new Headers(), body: malformed })),
        },
      ],
    };
  },
});

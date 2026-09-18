import { describe, expect, test } from 'vitest';

import { fetchMessages, fetchUnreadThreads, markThreadRead, openThread, sendMessage } from '../api';

const TASK = '11111111-1111-4111-8111-111111111111';
const PROBLEM = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';

const thread = {
  id: THREAD,
  host_id: '55555555-5555-4555-8555-555555555555',
  kind: 'task',
  task_id: TASK,
  problem_id: null,
  profile_id: null,
  created_at: '2026-09-18T10:00:00+00:00',
  last_message_at: null,
  last_author_id: null,
  message_count: 0,
};

const message = {
  id: MESSAGE,
  thread_id: THREAD,
  author_id: '66666666-6666-4666-8666-666666666666',
  author_name: 'Olga Manager',
  author_role: 'manager',
  body: 'Ключи в боксе',
  media_expected: 0,
  created_at: '2026-09-18T10:01:00+00:00',
  task_media: [],
};

/**
 * What the panel says to the server, word for word.
 *
 * Every call is recorded: the RPC name and its arguments, the table and the
 * select string, the filters. The rows come back through zod, which takes
 * `unknown`, so nothing in the types would notice an argument named wrong.
 */
function recordingClient(answers: Record<string, unknown>) {
  const rpcs: { name: string; args: unknown }[] = [];
  const reads: { table: string; select: string; calls: [string, ...unknown[]][] }[] = [];

  const builder = (table: string) => {
    const read = { table, select: '', calls: [] as [string, ...unknown[]][] };
    reads.push(read);
    const result = Promise.resolve({ data: answers[table] ?? [], error: null });
    const self: Record<string, unknown> = {
      then: result.then.bind(result),
      catch: result.catch.bind(result),
      finally: result.finally.bind(result),
    };
    for (const name of ['eq', 'is', 'order', 'limit']) {
      self[name] = (...args: unknown[]) => {
        read.calls.push([name, ...args]);
        return self;
      };
    }
    self.select = (columns: string) => {
      read.select = columns;
      return self;
    };
    return self;
  };

  const client = {
    from: (table: string) => builder(table),
    rpc: (name: string, args: unknown) => {
      rpcs.push({ name, args });
      return Promise.resolve({ data: answers[name] ?? null, error: null });
    },
  } as never;

  return { client, rpcs, reads };
}

describe('what is unread', () => {
  test('is asked for the whole company in one call and keeps the subject ids', async () => {
    const { client, rpcs } = recordingClient({
      chat_unread_threads: [
        {
          thread_id: THREAD,
          kind: 'task',
          task_id: TASK,
          problem_id: null,
          profile_id: null,
          last_message_at: '2026-09-18T10:07:00+00:00',
        },
      ],
    });

    const rows = await fetchUnreadThreads(client);

    expect(rpcs).toEqual([{ name: 'chat_unread_threads', args: undefined }]);
    expect(rows.map((row) => row.task_id)).toEqual([TASK]);
  });

  test('is nothing when the server says nothing', async () => {
    const { client } = recordingClient({});

    expect(await fetchUnreadThreads(client)).toEqual([]);
  });
});

describe('opening a thread', () => {
  test('names the task and nothing else', async () => {
    const { client, rpcs } = recordingClient({ open_thread: thread });

    const opened = await openThread(client, { taskId: TASK });

    expect(rpcs).toEqual([{ name: 'open_thread', args: { p_task_id: TASK } }]);
    expect(opened.id).toBe(THREAD);
  });

  test('names the problem and nothing else', async () => {
    const { client, rpcs } = recordingClient({
      open_thread: { ...thread, kind: 'problem', task_id: null, problem_id: PROBLEM },
    });

    await openThread(client, { problemId: PROBLEM });

    expect(rpcs).toEqual([{ name: 'open_thread', args: { p_problem_id: PROBLEM } }]);
  });
});

describe('reading a thread', () => {
  test('asks for the transcript of one thread, oldest first', async () => {
    const { client, reads } = recordingClient({ chat_messages: [message] });

    const rows = await fetchMessages(client, THREAD);

    expect(reads).toHaveLength(1);
    expect(reads[0].table).toBe('chat_messages');
    expect(reads[0].select).toContain('author_name');
    expect(reads[0].select).toContain('author_role');
    expect(reads[0].calls).toEqual([
      ['eq', 'thread_id', THREAD],
      ['is', 'task_media.deleted_at', null],
      ['is', 'task_media.purged_at', null],
      ['order', 'created_at', { ascending: true }],
      ['order', 'id', { ascending: true }],
      ['order', 'created_at', { referencedTable: 'task_media', ascending: true }],
    ]);
    expect(rows[0].body).toBe('Ключи в боксе');
  });

  test('brings the photos of a message in the same call, oldest first', async () => {
    const { client, reads } = recordingClient({
      chat_messages: [
        {
          ...message,
          media_expected: 2,
          task_media: [
            {
              id: '77777777-7777-4777-8777-777777777777',
              storage_path: 'host/chat/thread/77777777.jpg',
              uploaded_at: '2026-09-18T10:02:00+00:00',
              created_at: '2026-09-18T10:01:30+00:00',
            },
            {
              id: '88888888-8888-4888-8888-888888888888',
              storage_path: 'host/chat/thread/88888888.jpg',
              uploaded_at: null,
              created_at: '2026-09-18T10:01:40+00:00',
            },
          ],
        },
      ],
    });

    const rows = await fetchMessages(client, THREAD);

    expect(reads[0].select).toContain('task_media(');
    expect(rows[0].task_media.map((photo) => photo.uploaded_at)).toEqual([
      '2026-09-18T10:02:00+00:00',
      null,
    ]);
  });

  test('reads a message with no photos as an empty list, not as missing', async () => {
    const { client } = recordingClient({
      chat_messages: [
        {
          id: message.id,
          thread_id: THREAD,
          author_id: message.author_id,
          author_name: message.author_name,
          author_role: 'manager',
          body: 'Ключи в боксе',
          media_expected: 0,
          created_at: message.created_at,
        },
      ],
    });

    const rows = await fetchMessages(client, THREAD);

    expect(rows[0].task_media).toEqual([]);
  });
});

describe('writing', () => {
  test('sends the id the panel minted, so a retry replays', async () => {
    const { client, rpcs } = recordingClient({ send_message: message });

    const sent = await sendMessage(client, {
      id: MESSAGE,
      body: 'Ключи в боксе',
      subject: { taskId: TASK },
    });

    expect(rpcs).toEqual([
      {
        name: 'send_message',
        args: { p_id: MESSAGE, p_body: 'Ключи в боксе', p_task_id: TASK },
      },
    ]);
    expect(sent.id).toBe(MESSAGE);
  });

  test('marks read up to the moment it was given', async () => {
    const { client, rpcs } = recordingClient({});

    await markThreadRead(client, THREAD, '2026-09-18T10:01:00+00:00');

    expect(rpcs).toEqual([
      {
        name: 'mark_thread_read',
        args: { p_thread_id: THREAD, p_up_to: '2026-09-18T10:01:00+00:00' },
      },
    ]);
  });
});

-- F16. The catalogue of steps a process can be built from.
--
-- Alone in its own file, like every new enum (see 20260904120000).
--
-- Three types are functional in F16:
--   task_note        the manager's note on the task, ticked off line by line
--   confirmation     an instruction of the manager's own wording with a single
--                    "done" — "windows shut, lights off, keys in the box"
--   cleaner_comment  free text from the cleaner at the end
--
-- The rest are reserved so templates can name them now and the app can show
-- them as "not available in this version" rather than crash on an unknown
-- value. They come alive with their phases: photos_before / photos_after /
-- video in F8, checklist in F7, inventory in F17, special_requests in F20.
-- Which types are live is answered by `workflow_supported_step_types()`.

create type public.workflow_step_type as enum (
  'photos_before',
  'checklist',
  'inventory',
  'special_requests',
  'photos_after',
  'video',
  'task_note',
  'cleaner_comment',
  'confirmation'
);

comment on type public.workflow_step_type is
  'Step catalogue of the cleaning process. Live in F16: task_note, confirmation, cleaner_comment; the rest wait for F7/F8/F17/F20.';

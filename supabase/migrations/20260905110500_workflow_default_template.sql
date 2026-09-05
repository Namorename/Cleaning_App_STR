-- F16. The process every cleaning follows until the owner changes it.
--
-- One template for the company, scope 'cleaning', applied to every listing
-- through resolve_workflow_template(). No rows per listing are created.
--
-- A soft start, by the owner's decision: every step is optional. The cleaner
-- sees the steps and may walk through them, and may also finish the cleaning
-- without touching them. When it becomes clear what actually needs to be
-- enforced, a step is made required — in Studio
-- (`update public.workflow_steps set required = true where …`) or through
-- save_workflow_template() from the manager panel — and from then on the
-- finish gate holds until it is done or a manager waives it.
--
-- Titles are left null where the app's own translation is right, so each
-- cleaner reads the step in her own language.

with template as (
  insert into public.workflow_templates (scope, name)
  values ('cleaning', 'Стандартная уборка')
  returning id, host_id
)
insert into public.workflow_steps (
  template_id, host_id, sort_order, type, required, title, instructions
)
select template.id, template.host_id, step.sort_order, step.type, step.required,
       step.title, step.instructions
from template,
     (values
       -- Omitted at snapshot time when the task has no note.
       (1, 'task_note'::public.workflow_step_type, false, null, null),
       (2, 'confirmation'::public.workflow_step_type, false, 'Финальная проверка',
        E'Окна закрыты\nСвет и техника выключены\nМусор вынесен\nКлючи на месте'),
       (3, 'cleaner_comment'::public.workflow_step_type, false, null, null)
     ) as step(sort_order, type, required, title, instructions);

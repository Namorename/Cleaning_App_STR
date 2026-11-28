# Пробы аудита «Здоровья объектов» (28.11.2026)

Только чтение. Облако — `node scripts/cloud-read.mjs <файл.sql>` (роль без прав записи), Hostaway —
`node scripts/hostaway-get.mjs <путь>` (только GET). Ответы Hostaway с текстами никогда не
печатаются: они идут через `|` в локальный скрипт, который пишет на диск только числа, даты, флаги,
длины и хэши. Файлы с реальными id отзывов, броней и переписок (выход скриптов) в репозиторий не
кладутся — только шаблоны. Запускать из корня дерева; `$S` — папка для промежуточных файлов вне
репозитория.

## Отзывы и связка с уборкой

    for off in 0 500 1000 1500 2000 2500 3000 3500 4000 4500 5000; do
      node scripts/hostaway-get.mjs "reviews?type=guest-to-host&submittedAtStart=2025-11-01&sortBy=submittedAt&sortOrder=asc&limit=500&offset=$off" \
        | node docs/design/property-health/probes/derive-reviews.mjs "$S/reviews.ndjson" "$S/review-keys.json"
      node -e "setTimeout(()=>{},2500)"
    done
    node docs/design/property-health/probes/build-link-sql.mjs "$S/reviews.ndjson" docs/design/property-health/probes/link-template.sql "$S/link.sql" 2026-10-15
    node scripts/cloud-read.mjs "$S/link.sql"

`review-keys.json` — какие поля и аспекты приходят по каналам (только имена и счётчики).

## Переписки карточек из чатов

Список переписок — из `signal_findings.external_conversation_id` (живые карточки) и копии удалённых
карточек `~/.str-ops/backups/2026-11-26-chat-cards/backup.json`; в `$S/cards.json` — массив
`{id, conv, created, exact, status, kind, subject, urgency, property, conf}` (`exact` — время карточки
не обрезано до месяца).

    for c in $(cat "$S/conv-sample.txt"); do
      node scripts/hostaway-get.mjs "conversations/$c/messages?limit=100" \
        | node docs/design/property-health/probes/derive-messages.mjs "$c" "$S/messages.ndjson" "$S/message-keys.json"
      node -e "setTimeout(()=>{},2500)"
    done
    STRICT=1 node docs/design/property-health/probes/analyze-chats.mjs "$S/cards.json" "$S/messages.ndjson" "$S/chat-result.json"

`STRICT=1` — человеком считается только сообщение с `userId`; без него — и ответы без автора.

## Работа после карточки

`followup-template.sql`: вместо `/*VALUES*/` — строки
`('<id карточки>'::uuid, <property_id>, timestamptz '<created>', '<kind>', '<subject>', '<status>', '<группа>')`,
группа по `subject`: internet_tv, appliance → tech; heating, plumbing_leak, electric, hot_water,
drain_toilet, air_conditioning → engineering; furniture, window_blind → comfort; lock_door → access;
mould_damp → cleanliness; other → other (access + other → access).

## Без входных данных

    node scripts/cloud-read.mjs docs/design/property-health/probes/control.sql
    node scripts/cloud-read.mjs docs/design/property-health/probes/cleaning.sql

`control.sql` — «Задания»: статусы, работа, фото, время закрытия, возвраты темы, зависшие, планы.
`cleaning.sql` — уборки: фото, шаги, замер времени против нормы места, просроченные по неделям, кто
убирает места, постоянные горничные, техники по домам.

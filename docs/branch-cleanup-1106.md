# Уборка веток 06.11

Решение владельца 06.11: удалить только полностью влитые, про остальные спросить. `main` — `a0fc67a`.
Удалённые ветки — предки `main`, их коммиты никуда не делись. Вернуть любую: `git branch <имя> <хеш>`.

## Состояние после второй уборки (06.11)

Владелец отменил часть удалений 06.11: невлитые ветки не удалять, рабочие папки убирать только там, где
нет ничего, чего нет в `main`. Папки `guest-signals-design-1031`, `integration-rehearsal-1028`,
`integration-rehearsal-1030`, `knowledge-base-1015`, `mcp-server-1104`, `reviews-tasks-1015`,
`reviews-to-tasks-1017`, `rollout-plan-1028`, `dashboard-1014` удалены, ветки остались. Незакоммиченных
правок в них не было; две неотслеживаемые миграции `dashboard-1014` совпали с `main` байт в байт.

**Не удалять, слово владельца.** `guest-signals-design-1031`, `guest-texts-line-1102` (дерево
`mcp-server-1104`), `integration-rehearsal-1028`, `integration-rehearsal-1030`, `knowledge-base-1015`,
`reviews-tasks-1015`, `reviews-to-tasks-1017`, `rollout-plan-1028`, `dashboard-1014`,
`dashboard-stage2-1015`, `property-quality-1106` на origin. Копий этих веток на origin нет, кроме последней.
`dashboard-1014` восстановлена локально на `1a20c2e` после второй уборки.

**Держать.** `ios-build-1-2-0`, `ios-build-signin-1014`: дерево установленной iOS-сборки, до новой сборки.

**Текущая работа.** `staff-sign-in-block-1106`, `phone-banned-text-1106`, `theme-agreement-1106`,
`themes-v2-1106`.

Журналы с хешами: `%USERPROFILE%\.str-ops\branch-cleanup-1106\`. Невлитую ветку вернуть по хешу можно,
пока git не убрал недостижимые объекты.

## Удалено во второй уборке локально: названные владельцем и из удалённых деревьев (17)

| Ветка | Хеш |
|---|---|
| `backup/video-upload-1022-pre-reorder-1023` | `6a4e336` |
| `backup/video-upload-1022-pre-reorder-1023b` | `004c873` |
| `chore-docs-remote-control` | `bea8ed1` |
| `dashboard-pdf-1015` | `f3eda7d` |
| `dashboard-pdf-main-1016` | `0e0aee2` |
| `docs-post-launch` | `9e8206c` |
| `docs-tail-1106` | `94486cd` |
| `docs-woom-domain` | `39be42a` |
| `guest-signals-intake-1031` | `0522296` |
| `launch-prep-1015` | `8c81082` |
| `launch-reset-1016` | `0fb6221` |
| `main-filter-search-1021` | `9bedd62` |
| `main-wording-1010` | `34f8511` |
| `merge-check-1-2-0` | `8dfa993` |
| `merge-check-panel` | `a2319e1` |
| `merge-main-1-2-0` | `3877dc1` |
| `ops-1010` | `8d800f2` |

## Удалено во второй уборке локально: влитые без дерева (22)

| Ветка | Хеш |
|---|---|
| `guest-signals-texts-boundary-1102` | `5fae648` |
| `integration-rehearsal-1031` | `09d6664` |
| `kb-techs-read-all-1031` | `8087f14` |
| `knowledge-base-phone-1017` | `cd39831` |
| `knowledge-base-step1-1017` | `db42d9e` |
| `main-pdf-1016` | `804ac7a` |
| `main-privacy-1016` | `b7fcc0f` |
| `manual-time-1029` | `2627231` |
| `media-fixes-1104` | `4fe2133` |
| `panel-filter-search-1021` | `f40fadd` |
| `panel-fixes-1010` | `3410516` |
| `phone-1-2-0` | `e820308` |
| `photo-viewer-1103` | `848a6c5` |
| `privacy-page` | `8aab6f2` |
| `privacy-wording-1010` | `4a3fa13` |
| `property-intelligence-plan-1106` | `bdf1e95` |
| `property-quality-1106` | `424c86e` |
| `public-api-v1-1028` | `c3eac69` |
| `push-release-1010` | `3da0414` |
| `video-gallery-setting` | `16bb5f6` |
| `video-upload-1022` | `3c8df45` |
| `web-layout-1012` | `7d9b597` |

## Удалено во второй уборке на origin (11)

| Ветка | Хеш |
|---|---|
| `dashboard-1014` | `1a20c2e` |
| `dashboard-pdf-1015` | `f3eda7d` |
| `dashboard-pdf-main-1016` | `b62abd9` |
| `guest-signals-design-1031` | `46bf205` |
| `guest-texts-line-1102` | `0adb654` |
| `integration-rehearsal-1028` | `f3815d6` |
| `integration-rehearsal-1030` | `69fd4b0` |
| `knowledge-base-1015` | `331788b` |
| `reviews-tasks-1015` | `93ba0e0` |
| `reviews-to-tasks-1017` | `05175af` |
| `rollout-plan-1028` | `c3abb72` |

## Удалено локально (27)

| Ветка | Хеш |
|---|---|
| `cleanings-cancel-overdue-1105` | `7fe7126` |
| `docs-main-1010` | `e877d92` |
| `docs-rollout-writes-1010` | `7012cba` |
| `guest-review-text-1104` | `169a861` |
| `guest-reviews-1104` | `6037ff3` |
| `lang-default-en-1015` | `01a402c` |
| `launch-main` | `d0ccd15` |
| `main-dashboard-1016` | `113f992` |
| `main-privacy-1010` | `82d148a` |
| `main-step0-1028` | `e775922` |
| `main-step1-1029` | `a167849` |
| `main-step2-1029` | `d10f0dd` |
| `mcp-server-1104` | `f502470` |
| `merge-main-chat-1008` | `9bcfab3` |
| `merge-reserve-1010` | `5debcaa` |
| `panel-calendar-1010` | `22fe3fb` |
| `panel-theme-1010` | `64302ce` |
| `panel-video-tech` | `5a040b7` |
| `phone-insets-1010` | `3971b21` |
| `privacy-journal-1015` | `b79298b` |
| `privacy-settings-1010` | `bf68bbc` |
| `redesign-native-screens` | `1e787b2` |
| `redesign-screens` | `e4f197c` |
| `repairs-apart-1105` | `3e546d6` |
| `repairs-own-places-1105` | `289db3c` |
| `reserve-1010` | `36d1399` |
| `signin-fixes-phone` | `c05fd6b` |

## Удалено на origin (49)

| Ветка | Хеш |
|---|---|
| `chore-docs-remote-control` | `bea8ed1` |
| `chore-new-machine` | `35e60c4` |
| `dashboard-stage2-1015` | `c0c299d` |
| `docs-post-launch` | `9e8206c` |
| `docs-rollout-writes-1010` | `7012cba` |
| `docs-woom-domain` | `39be42a` |
| `guest-review-text-1104` | `3ec9c5d` |
| `guest-reviews-1104` | `6037ff3` |
| `guest-signals-intake-1031` | `0522296` |
| `guest-signals-texts-boundary-1102` | `5fae648` |
| `integration-rehearsal-1031` | `09d6664` |
| `knowledge-base-phone-1017` | `cd39831` |
| `knowledge-base-step1-1017` | `db42d9e` |
| `lang-default-en-1015` | `01a402c` |
| `launch-main` | `32bc6bf` |
| `launch-prep-1015` | `84deb86` |
| `launch-reset-1016` | `0fb6221` |
| `maintenance-problem-id` | `c1967e8` |
| `manual-time-1029` | `2627231` |
| `mcp-server-1104` | `5c5c329` |
| `merge-reserve-1010` | `5debcaa` |
| `mobile-401-retry` | `c3fb7ec` |
| `ops-1010` | `8d800f2` |
| `panel-calendar-1010` | `22fe3fb` |
| `panel-filter-search-1021` | `f40fadd` |
| `panel-fixes-1010` | `3410516` |
| `panel-theme-1010` | `64302ce` |
| `panel-unassign-rpc` | `f969563` |
| `panel-video-tech` | `5a040b7` |
| `phone-1-2-0` | `e820308` |
| `phone-insets-1010` | `3971b21` |
| `privacy-journal-1015` | `b79298b` |
| `privacy-page` | `8aab6f2` |
| `privacy-settings-1010` | `bf68bbc` |
| `privacy-wording-1010` | `4a3fa13` |
| `public-api-v1-1028` | `c3eac69` |
| `push-release-1010` | `3da0414` |
| `redesign-5.2` | `37ff4b7` |
| `redesign-native` | `b59bc9e` |
| `redesign-native-screens` | `1e787b2` |
| `redesign-phone` | `9c56d38` |
| `redesign-phone-screens` | `be8f7b9` |
| `redesign-screens` | `e4f197c` |
| `reserve-1010` | `36d1399` |
| `signin-fixes-phone` | `c05fd6b` |
| `staff-disable` | `87847b3` |
| `tech-server` | `30c59fd` |
| `video-gallery-setting` | `16bb5f6` |
| `video-upload-1022` | `3c8df45` |

# Уборка веток 06.11

Решение владельца 06.11: удалить только полностью влитые, про остальные спросить. `main` — `a0fc67a`.
Удалённые ветки — предки `main`, их коммиты никуда не делись. Вернуть любую: `git branch <имя> <хеш>`.

## Ждут решения владельца

**Влиты, но заняты рабочим деревом (30).** Ветку нельзя удалить, пока есть дерево, а дерево — это папка на диске. `chore-docs-remote-control`, `dashboard-stage2-1015`, `docs-post-launch`, `docs-woom-domain`, `guest-signals-intake-1031`, `guest-signals-texts-boundary-1102`, `integration-rehearsal-1031`, `kb-techs-read-all-1031`, `knowledge-base-phone-1017`, `knowledge-base-step1-1017`, `launch-prep-1015`, `launch-reset-1016`, `main-filter-search-1021`, `main-pdf-1016`, `main-privacy-1016`, `main-wording-1010`, `manual-time-1029`, `media-fixes-1104`, `ops-1010`, `panel-filter-search-1021`, `panel-fixes-1010`, `phone-1-2-0`, `photo-viewer-1103`, `privacy-page`, `privacy-wording-1010`, `public-api-v1-1028`, `push-release-1010`, `video-gallery-setting`, `video-upload-1022`, `web-layout-1012`.

**Не влиты: содержимое уже в `main`.** Документы перенесены 06.11: `guest-signals-design-1031`, `rollout-plan-1028`, `guest-texts-line-1102`, `reviews-tasks-1015`.

**Не влиты: старый код, заменён ядром сигналов.** `reviews-to-tasks-1017`, `integration-rehearsal-1028`, `integration-rehearsal-1030`.

**Не влиты: уникальных файлов нет, содержимое в `main` другими хешами.** `dashboard-1014`, `dashboard-pdf-1015`, `dashboard-pdf-main-1016`, `knowledge-base-1015`, `merge-check-1-2-0`, `merge-check-panel`, `merge-main-1-2-0`. У `dashboard-pdf-main-1016` локальная копия влита, а на origin есть 3 коммита вне `main`.

**Резервные копии.** `backup/video-upload-1022-pre-reorder-1023`, `backup/video-upload-1022-pre-reorder-1023b`.

**Держать.** `ios-build-1-2-0`, `ios-build-signin-1014`: дерево установленной iOS-сборки, до новой сборки. `property-quality-1106`, `property-intelligence-plan-1106`, `staff-sign-in-block-1106`: текущая работа.

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

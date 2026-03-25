# UI Profile Design

This project uses profile-driven UI matching instead of a single hard-coded selector system.

## Goals

- Keep locale/platform/tier-specific UI differences in data files.
- Prefer accessibility labels and visible text before raw CSS selectors.
- Allow ordered fallback candidates when labels drift across ChatGPT UI variants.
- Keep project selection and new-chat branching explicit in plan generation.

## Profile Files

Current examples:

- `profiles/ko-KR.windows.pro.json`
- `profiles/ko-KR.windows.plus.json`

Each profile can define:

- browser/platform/locale metadata
- UI tier (`pro`, `plus`)
- selector candidates for project entry/search/list
- selector candidates for new chat
- selector candidates for mode menu and options
- selector candidates for tools/attachment menu items
- prompt box and submit button candidates

## Candidate Priority Model

Resolution order:

1. accessibility label candidates
2. visible text candidates
3. fallback selectors

Each candidate list is stored in order and tried sequentially.

## Required Tool Labels

The Korean Windows profiles currently include these baseline candidates:

- `최신`
- `Instant`
- `Thinking`
- `Pro`
- `구성...`
- `사진 및 파일 업로드`
- `최근 파일`
- `심층 리서치`
- `쇼핑 어시스턴트`
- `웹 검색`
- `공부하기`
- `더 보기`

## Flow Rules

- If `project` is omitted, the plan defaults to new chat.
- If `project` is specified, the plan enters that project and does not create an extra new chat by default.
- `dryRun` should progress through flow planning and stop before the actual submit action.
- The returned receipt should include the interpreted profile/tier and selection notes.

# Choose the questionnaire replacement policy

Type: grilling
Status: resolved
Blocked by: 11

## Question

Should `ask_user` temporarily coexist with `questionnaire` for a staged migration, or replace and remove `questionnaire` directly?

## Answer

Replace `questionnaire` directly. A repository-wide search found no references to the `questionnaire` tool outside `agent/extensions/questionnaire.ts`, so the implementation should add the adapted upstream `ask_user` tool and delete the old extension in the same change. Do not retain an alias, compatibility shim, dual registration, batch-question contract, opaque option values, or `allowOther: false` behavior.

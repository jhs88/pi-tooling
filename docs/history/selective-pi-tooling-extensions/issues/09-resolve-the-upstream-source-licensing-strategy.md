# Resolve the upstream source licensing strategy

Type: grilling
Status: resolved
Blocked by: 01

## Question

Ben Davis's repository has no explicit license. Should this effort pause direct source adaptation of the file-search, Firecrawl, workflows, ask-user, and background-terminal extensions while seeking written permission or a recognized license, proceed through clean-room implementations based only on behavior and independently written specifications, or take another legally supportable route?

## Answer

Per the repository owner's explicit direction, copy and adapt the selected source directly from the pinned GitHub snapshot `davis7dotsh/my-pi-setup@797eaf6d6f178759cf7aabde927ef15c91346e7e`. Preserve the README credit/source link, add concise upstream provenance to adapted extension documentation where useful, and keep local compatibility, security, routing, and testing changes clearly separated. No clean-room rewrite or additional permission gate is required for this effort.

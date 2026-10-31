# Owner email templates (for Resend)

Three HTML emails for the owner side, written for [Resend templates](https://resend.com/docs/dashboard/templates/introduction): table layout, inline styles, 560px wide, readable without images, a hidden inbox preview line, and a button that also works as a plain link.

In Resend: **Emails → Templates → Create template**, paste the file's HTML, and keep the variables exactly as written. Resend fills each `{{{NAME}}}` (three braces, upper case) from the variables the API sends.

| Template (file) | When it is sent | Subject to set | Variables |
|---|---|---|---|
| `owner-invite.html` | An owner or staff login is created (by the Super Admin, by the owner, or the owner's own sign-up): a link to choose a password | `You have been invited to TurfX` | `NAME`, `LINK`, `EXPIRY` |
| `owner-password-reset.html` | Someone presses Forgot password on the owner portal | `Reset your TurfX password` | `NAME`, `LINK`, `EXPIRY` |
| `owner-approved.html` | The Super Admin approves an owner who signed up on their own | `Your TurfX owner account is approved` | `BUSINESS_NAME`, `LOGIN_URL` |

What each variable holds:

- `NAME`: the person's name, for example `Asha Menon`.
- `LINK`: the one-time set-password or reset link, for example `https://owner.example.com/reset-password?token=...`.
- `EXPIRY`: how long the link lasts, already worded, for example `72 hours` or `30 minutes`.
- `BUSINESS_NAME`: the owner's business name.
- `LOGIN_URL`: the owner portal sign-in address.

After creating each template, give the template ID (looks like `4c8ff2b3-...`) for each one. The API already knows how to send a Resend template (`template: { id, variables }` in `src/identity/mail.service.ts`); the last step is to read the three IDs from settings (for example `RESEND_TEMPLATE_OWNER_INVITE`) and pass these variables. Until an ID is set, the current plain HTML emails keep going out unchanged.

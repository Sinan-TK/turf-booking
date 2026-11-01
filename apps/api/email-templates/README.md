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

After creating each template, put its ID (looks like `4c8ff2b3-...`) in `apps/api/.env`, then restart the API:

```
RESEND_OWNER_INVITE_TEMPLATE_ID=<id of owner-invite>
RESEND_OWNER_RESET_TEMPLATE_ID=<id of owner-password-reset>
RESEND_OWNER_APPROVED_TEMPLATE_ID=<id of owner-approved>
```

A template that has no ID set keeps sending the built-in plain email, so you can switch them on one at a time. In production set them where the API's other secrets are set.

## Safety: what goes into the variables

`NAME` and `BUSINESS_NAME` are typed by people (an owner signing themselves up chooses both), and Resend puts a `{{{...}}}` value into the page as it is. So the API must **HTML-escape those two values (`& < > " '`) before it passes them**, and it does (`escapeHtml` in `src/identity/local-identity.adapter.ts` already does this for the plain emails sent today). `LINK`, `LOGIN_URL` and `EXPIRY` are built by the API itself, never from user input; `LINK` and `LOGIN_URL` are the owner portal's own https address plus a one-time token. Do not put any other user-typed value into a template without the same escaping.

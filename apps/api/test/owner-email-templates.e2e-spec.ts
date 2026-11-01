// The template ids are read when the API starts, so they are set before the app is made.
process.env.RESEND_OWNER_INVITE_TEMPLATE_ID = 'tmpl-owner-invite';
process.env.RESEND_OWNER_RESET_TEMPLATE_ID = 'tmpl-owner-reset';
process.env.RESEND_OWNER_APPROVED_TEMPLATE_ID = 'tmpl-owner-approved';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MailService, type MailMessage } from '../src/identity/mail.service';
import { createTestApp } from './setup/test-app';
import { loginAsSuperAdmin, prisma, uniqueSuffix, type TestAgent } from './setup/fixtures';

/** The owner emails are sent through the Resend templates whose ids are set, with the variables the HTML templates expect. */
describe('Owner emails through Resend templates', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let sent: MailMessage[];
  const tag = uniqueSuffix().replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  const email = `e2e-tpl-${tag}@example.com`;
  let organizationId: string;

  beforeAll(async () => {
    app = await createTestApp({ throttle: false });
    admin = await loginAsSuperAdmin(app);
    sent = [];
    jest.spyOn(app.get(MailService), 'send').mockImplementation(async (m) => {
      sent.push(m);
      return true;
    });
    const org = await admin.post('/admin/organizations').send({ name: `E2E Template Org ${tag}`, contactEmail: email, contactPhone: '9847012345' }).expect(201);
    organizationId = org.body.id;
  });
  afterAll(async () => {
    await prisma.ownerOrganization.deleteMany({ where: { name: { startsWith: 'E2E Template Org' } } });
    await app.close();
  });

  it('the invite uses the invite template, with the name escaped and a link and expiry the API built', async () => {
    await admin.post(`/admin/organizations/${organizationId}/owner-users`).send({ email, name: '<img src=x onerror=alert(1)>Asha & Co', role: 'OWNER_ADMIN' }).expect(201);
    const mail = sent.find((m) => m.to === email)!;
    expect(mail.template?.id).toBe('tmpl-owner-invite');
    const vars = mail.template!.variables;
    expect(Object.keys(vars).sort()).toEqual(['EXPIRY', 'LINK', 'NAME']);
    expect(vars.NAME).toBe('&#60;img src=x onerror=alert(1)&#62;Asha &#38; Co'); // the escaper writes numeric entities
    expect(vars.NAME).not.toMatch(/[<>]/);
    expect(vars.LINK).toMatch(/\/reset-password\?token=[A-Za-z0-9_-]+$/);
    expect(vars.EXPIRY).toMatch(/^\d+ hours$/);
  });

  it('forgot password uses the reset template with minutes as the expiry', async () => {
    sent.length = 0;
    await request(app.getHttpServer()).post('/auth/owner/forgot-password').send({ email }).expect(200);
    const mail = sent.find((m) => m.to === email)!;
    expect(mail.template?.id).toBe('tmpl-owner-reset');
    expect(mail.template!.variables.EXPIRY).toMatch(/^\d+ minutes$/);
    expect(mail.template!.variables.LINK).toMatch(/\/reset-password\?token=/);
  });

  it('approving a sign-up uses the approved template with the business name and the sign-in address', async () => {
    const waiting = await prisma.ownerOrganization.create({ data: { name: `E2E Template Org <b>${tag}</b>`, contactEmail: `e2e-tpl-ok-${tag}@example.com`, contactPhone: '+919847012345', status: 'PENDING_APPROVAL' } });
    sent.length = 0;
    await admin.patch(`/admin/organizations/${waiting.id}/status`).send({ status: 'ACTIVE' }).expect(200);
    const mail = sent.find((m) => m.to === waiting.contactEmail)!;
    expect(mail.template?.id).toBe('tmpl-owner-approved');
    expect(Object.keys(mail.template!.variables).sort()).toEqual(['BUSINESS_NAME', 'LOGIN_URL']);
    expect(mail.template!.variables.BUSINESS_NAME).not.toMatch(/[<>]/);
    expect(mail.template!.variables.LOGIN_URL).toMatch(/\/login$/);
  });
});

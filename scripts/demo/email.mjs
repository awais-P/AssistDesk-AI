// Email helpers for the local demo (npm run demo). Settings come from .env.demo, then .env.
//
//   npm run email:test -- [--to you@gmail.com]
//       Sends one test email through the SMTP settings (ASSISTDESK_SMTP_*), the same account
//       that sends ticket replies. Run it once before the demo.
//
//   npm run email:receive -- --from you@gmail.com --subject "Where is my order 1042?" [--text "..."] [--name "Ali Raza"]
//   npm run email:receive -- --from you@gmail.com --reply 123 --text "Thanks, and the receipt?"
//       Delivers an email to AssistDesk the way an email provider would: a POST to the inbound
//       email webhook with the demo workspace's secret (read from the database, nothing to copy).
//       It creates a ticket (or, with --reply, adds to ticket 123), then waits for the AI reply
//       and shows whether it was emailed back.
//
// A real mailbox cannot deliver to localhost, so this script stands in for the email provider.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import pg from "pg";
import { E2E } from "../e2e/config.mjs";

const ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE); // does not override values already set from .env.demo
}

const DEMO_WIDGET = process.env.E2E_WIDGET_ID ?? "assistdesk-widget-demo";
const [command, ...rest] = process.argv.slice(2);
const options = {};
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i].startsWith("--")) {
    options[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : "true";
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function smtpSettings() {
  const host = process.env.ASSISTDESK_SMTP_HOST?.trim();
  if (!host) {
    fail("No SMTP sender is configured. Fill in the ASSISTDESK_SMTP_* lines in .env.demo (see .env.demo.example).");
  }
  const port = Number(process.env.ASSISTDESK_SMTP_PORT || 587);
  return {
    host,
    port,
    secure: process.env.ASSISTDESK_SMTP_SECURE ? process.env.ASSISTDESK_SMTP_SECURE === "true" : port === 465,
    user: process.env.ASSISTDESK_SMTP_USER?.trim() || null,
    password: process.env.ASSISTDESK_SMTP_PASSWORD || null,
  };
}

async function testSmtp() {
  const smtp = smtpSettings();
  const to = options.to || smtp.user;
  if (!to) {
    fail("Pass --to <your email>.");
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? "" } : undefined,
    connectionTimeout: 10_000,
  });
  try {
    await transport.verify();
    await transport.sendMail({
      from: { name: "AssistDesk", address: process.env.ASSISTDESK_SMTP_FROM?.trim() || smtp.user || to },
      to,
      subject: "AssistDesk SMTP test",
      text: "This test email shows that AssistDesk can send ticket replies through your SMTP account.",
    });
  } catch (error) {
    fail(`SMTP test failed: ${error.message}\nFor Gmail, use an App Password (Google Account → Security → App passwords), not your normal password.`);
  }
  console.log(`Sent a test email to ${to} through ${smtp.host}:${smtp.port}. Check the inbox (and Spam).`);
}

async function receive() {
  const fromEmail = options.from?.trim().toLowerCase();
  if (!fromEmail || !fromEmail.includes("@")) {
    fail('Pass --from <customer email>, for example --from you@gmail.com');
  }

  const db = new pg.Client({ connectionString: E2E.databaseUrl });
  await db.connect();
  try {
    const q = async (sql, params) => (await db.query(sql, params)).rows;
    const [integration] = await q(
      `select i."webhookSecret", i."workspaceId" from "Integration" i
       where i.type = 'EMAIL' and i."isActive" and i.status = 'CONNECTED'
         and i."workspaceId" = (select "workspaceId" from "Chatbot" where "widgetId" = $1)
       limit 1`,
      [DEMO_WIDGET],
    );
    if (!integration?.webhookSecret) {
      fail("The demo workspace has no connected Email integration. Start the demo once with npm run demo.");
    }

    let subject = options.subject;
    if (options.reply) {
      const [ticket] = await q(
        `select t.subject, t."requesterEmail", coalesce(b."ticketPrefix", 'AD') as prefix from "Ticket" t
         left join "Inbox" b on b.id = t."inboxId" where t."workspaceId" = $1 and t."ticketNumber" = $2`,
        [integration.workspaceId, Number(options.reply)],
      );
      if (!ticket) {
        fail(`Ticket ${options.reply} was not found in the demo workspace.`);
      }
      if (ticket.requesterEmail?.toLowerCase() !== fromEmail) {
        fail(`Ticket ${options.reply} belongs to ${ticket.requesterEmail}; send the reply --from that address.`);
      }
      subject = `Re: ${ticket.subject.replace(/^Re:\s*/i, "")} [${ticket.prefix}-${options.reply}]`;
    }
    if (!subject) {
      fail('Pass --subject "..." (or --reply <ticket number>).');
    }

    const started = new Date();
    const response = await fetch(`${E2E.baseUrl}/api/integrations/email/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-assistdesk-secret": integration.webhookSecret },
      body: JSON.stringify({
        fromName: options.name || null,
        fromEmail,
        subject,
        text: options.text || subject,
        messageId: `<demo-${Date.now()}@assistdesk.local>`,
      }),
    }).catch((error) => fail(`Could not reach ${E2E.baseUrl}: ${error.message}. Is npm run demo running?`));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      fail(`AssistDesk refused the email (${response.status}): ${result.error ?? "unknown error"}`);
    }
    console.log(`Email received: ticket #${result.ticketNumber} (${result.outcome}). Open ${E2E.baseUrl}/dashboard/tickets/${result.ticketId}`);

    // The AI workflow runs after the webhook has answered; wait for its reply. Only confident
    // answers are emailed: a low-confidence draft (SYSTEM) or a fallback answer stays on the ticket.
    const deadline = Date.now() + 120_000;
    let seenAt = null;
    while (Date.now() < deadline) {
      const [reply] = await q(
        `select sender, "deliveryStatus", "deliveryError" from "TicketMessage"
         where "ticketId" = $1 and sender in ('AI', 'SYSTEM') and "createdAt" >= $2 order by "createdAt" desc limit 1`,
        [result.ticketId, started],
      );
      if (reply?.sender === "SYSTEM") {
        console.log("AI reply: confidence was too low, so it was kept on the ticket as a draft for your team (not emailed). Reply from the dashboard.");
        return;
      }
      if (reply?.deliveryStatus) {
        const notes = {
          SENT: `the AI reply was emailed to ${fromEmail}.`,
          NOT_CONFIGURED: "the AI replied on the ticket, but no SMTP sender is set, so it was not emailed.",
          FAILED: `the AI reply could not be emailed: ${reply.deliveryError}`,
          NO_RECIPIENT: "the ticket has no customer email.",
        };
        console.log(`AI reply: ${notes[reply.deliveryStatus] ?? reply.deliveryStatus}`);
        return;
      }
      if (reply) {
        seenAt ??= Date.now();
        if (Date.now() - seenAt > 20_000) {
          console.log("AI reply: written from the fallback (no AI model answered), so it was kept on the ticket and not emailed.");
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.log("No AI reply within 2 minutes. Check that AI replies are switched on for the inbox's agent, and the server log.");
  } finally {
    await db.end();
  }
}

if (command === "test") {
  await testSmtp();
} else if (command === "receive") {
  await receive();
} else {
  fail("Usage: node scripts/demo/email.mjs test|receive [options]. See the top of this file.");
}

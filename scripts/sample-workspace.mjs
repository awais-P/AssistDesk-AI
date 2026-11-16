// Creates the sample workspace (one of everything) with an Owner and an Agent login, and
// prints the logins. Run it where the server runs, e.g. Railway → service → Console:
//   node scripts/sample-workspace.mjs           create (or give both logins a new password)
//   node scripts/sample-workspace.mjs --delete  remove the sample workspace and its data
// Uses PORT and CRON_SECRET from the environment, so no secret is typed or shown.
const port = process.env.PORT || "3000";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set in this environment.");
  process.exit(1);
}

const remove = process.argv.includes("--delete");
const response = await fetch(`http://127.0.0.1:${port}/api/admin/sample-workspace`, {
  method: remove ? "DELETE" : "POST",
  headers: { authorization: `Bearer ${secret}` },
});
const data = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(`Failed (${response.status}):`, data.error ?? data);
  process.exit(1);
}

if (remove) {
  console.log(data.deleted ? "Sample workspace deleted." : "There was no sample workspace.");
} else {
  console.log(data.created ? "Sample workspace created." : "Sample workspace already exists; both logins have a new password.");
  if (data.knowledgeStatus) console.log(`Knowledge base: ${data.knowledgeStatus}`);
  console.log("");
  for (const login of data.logins) {
    console.log(`${login.role.padEnd(6)}  email: ${login.email}   password: ${login.password}`);
  }
}

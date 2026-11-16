const deadline = Date.now() + 60000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const result = await fetch("http://localhost:3000/api/health");
    if (result.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) throw new Error("Cliplane did not become ready within 60 seconds");
console.log("Cliplane is ready.");

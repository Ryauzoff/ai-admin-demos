/* Регресс-тест по косякам из демонстрации:
   1) имя не должно приниматься как «Хочу отменить запись»
   2) вопрос про график по ходу записи должен получать ответ про график
   3) вопрос цены в режиме отмены должен получать цену, а не «не нашла запись»
   4) падеж: «Передаю Анне», а не «Передаю Анна»
   5) в тексте слотов нет повторов и «удобное время» дважды
   6) список мастеров берётся из базы знаний, а не из хардкода про маникюр

   Запуск из корня проекта: node ai-admin-demo/regress.mjs */

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const puppeteer = require(path.resolve(__dirname, "../avtopoisk/node_modules/puppeteer-core"));

const EXE = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].find((p) => fs.existsSync(p));

const file = pathToFileURL(path.join(__dirname, "index.html")).href;

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files", "--font-render-hinting=none"],
  defaultViewport: { width: 1440, height: 900 }
});

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

async function open() {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(file, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector("#messages .msg", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 400));
  return { page, errors };
}

async function say(page, text) {
  const before = (await page.$$("#messages .msg--bot")).length;
  await page.$eval("#chatInput", (el, v) => {
    el.value = v;
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await page.$eval("#chatForm", (f) => f.requestSubmit());
  await page.waitForFunction(
    (n) => !document.querySelector("#typing") && document.querySelectorAll("#messages .msg--bot").length >= n,
    { timeout: 15000 },
    before + 1
  );
  await new Promise((r) => setTimeout(r, 300));
  const texts = await page.$$eval("#messages .msg--bot", (els) => els.map((e) => e.innerText.trim()));
  // Бот может ответить двумя репликами: на вопрос и возврат к записи.
  return texts.slice(-2).join(" || ");
}

// ---------- сценарий A: имя-команда ----------
{
  const { page, errors } = await open();
  const data = await page.evaluate(() => ({ admin: window.SALON.adminName, masters: window.SALON.masters.map((m) => m.name) }));

  await say(page, "хочу записаться");
  await say(page, "маникюр");
  await say(page, "любой свободный");
  const slotsMsg = await say(page, "завтра");
  check("слоты: без повтора «удобное время»", !/удобное время.*удобное время/i.test(slotsMsg) && !/Есть и другие окна/i.test(slotsMsg), slotsMsg.slice(0, 110));
  const nameAnswer = await say(page, "Хочу отменить запись");
  check("имя-команда не принимается за имя", !/приятно познакомиться/i.test(nameAnswer), nameAnswer.slice(0, 90));
  check("на «отменить» бот переходит к отмене", /отмен/i.test(nameAnswer), nameAnswer.slice(0, 90));

  check("нет ошибок консоли (A)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

// ---------- сценарий B: вопрос про график по ходу записи ----------
{
  const { page, errors } = await open();
  await say(page, "хочу записаться");
  await say(page, "маникюр");
  await say(page, "любой свободный");
  await say(page, "завтра");
  await say(page, "10:00");
  await say(page, "Анна");
  const answer = await say(page, "Вы работаете в воскресенье?");
  check("график: ответ про часы работы", /работа|график|часы|ежедневно|выходн/i.test(answer), answer.slice(0, 110));
  check("график: не просит цифры телефона", !/не хватает цифр/i.test(answer), answer.slice(0, 110));
  check("график: возвращает к записи", /телефон|продолжим/i.test(answer), answer.slice(0, 110));

  check("нет ошибок консоли (B)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

// ---------- сценарий C: цена в режиме отмены ----------
{
  const { page, errors } = await open();
  await say(page, "хочу отменить запись");
  const answer = await say(page, "Сколько стоит массаж?");
  check("цена в отмене: называет цену", /₽|\d{3,}/.test(answer), answer.slice(0, 110));
  check("цена в отмене: не «не нашла запись»", !/не нашла запись/i.test(answer), answer.slice(0, 110));
  check("цена в отмене: возвращает к отмене", /отмен|имя|телефон|продолжим/i.test(answer), answer.slice(0, 110));

  check("нет ошибок консоли (C)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

// ---------- сценарий D: падеж при передаче человеку ----------
{
  const { page, errors } = await open();
  const data = await page.evaluate(() => window.SALON.adminName);
  const answer = await say(page, "позовите живого человека");
  check("падеж в передаче человеку", answer.includes(`Передаю ${data.slice(0, -1)}е`) || /Передаю \w+е\b/.test(answer), answer.slice(0, 90));
  check("нет ошибок консоли (D)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

// ---------- сценарий E: список мастеров из базы ----------
{
  const { page, errors } = await open();
  const masters = await page.evaluate(() => window.SALON.masters.map((m) => m.name));
  const answer = await say(page, "какие у вас мастера");
  const found = masters.filter((m) => answer.includes(m));
  check("мастера: все из базы знаний", found.length === masters.length, `в ответе: ${found.join(", ") || "никого"}`);
  check("мастера: нет хардкода про маникюр", !/Алина - маникюр|Ольга - брови/.test(answer) || masters.includes("Алина"), answer.slice(0, 110));
  check("нет ошибок консоли (E)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

console.log("");
let bad = 0;
for (const r of results) {
  console.log((r.ok ? "OK   " : "ПРОВАЛ ") + r.name + (r.detail ? " — " + r.detail : ""));
  if (!r.ok) bad++;
}
console.log("");
console.log(bad === 0 ? "Регресс чистый" : "Провалов: " + bad);

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
process.exit(bad === 0 ? 0 : 1);

require('dotenv').config();

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'noreply@catgpt.local';
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false' && SMTP_PORT === 465;

let transporter = null;

function isConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransporter() {
  if (!isConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: false }
    });
  }
  return transporter;
}

async function sendVerificationCode(email, code) {
  const subject = 'CatGPT 邮箱验证码';
  const text = `您的验证码是：${code}\n\n验证码 10 分钟内有效，请勿泄露给他人。`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#10a37f">CatGPT</h2>
      <p>您的邮箱验证码为：</p>
      <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px;background:#f5f5f5;border-radius:8px;text-align:center">${code}</div>
      <p style="color:#888;font-size:13px;margin-top:16px">验证码 10 分钟内有效，请勿泄露给他人。</p>
    </div>
  `;

  if (!isConfigured()) {
    console.log(`\n  [开发模式] 邮箱验证码 → ${email}: ${code}\n`);
    return { dev: true, code };
  }

  const transport = getTransporter();
  try {
    await transport.verify();
  } catch (err) {
    throw new Error(`SMTP 连接失败: ${err.message}`);
  }

  await transport.sendMail({ from: SMTP_FROM, to: email, subject, text, html });
  return { dev: false };
}

module.exports = { sendVerificationCode, isConfigured };

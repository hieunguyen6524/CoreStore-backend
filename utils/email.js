const nodemailer = require('nodemailer');
const fs = require('fs');
const htmlToText = require('html-to-text');

class Email {
  /**
   *
   */
  constructor(user, url) {
    this.to = user.email;
    this.name = user.name;
    this.url = url;
    this.from = `CoreStore <${process.env.EMAIL_ADDRESS}>`;
  }

  newTransport() {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_ADDRESS,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  async send(template, subject) {
    const html = fs
      .readFileSync(`${__dirname}/../public/template/${template}.html`, 'utf-8')
      .replace('{{name}}', this.name)
      .replace('{{tokenUrl}}', this.url)
      .replace('{{subject}}', subject)
      .replace('{{year}}', new Date().getFullYear());

    const mailOption = {
      from: this.from,
      to: this.to,
      subject,
      html,
      text: htmlToText.convert(html),
    };

    await this.newTransport().sendMail(mailOption);
  }

  async sendPasswordReset() {
    await this.send(
      'forgotPasswordEmail',
      'You requested to reset your password. Click the button below to set a new password. This link is valid for only 10 minutes.',
    );
  }
}

module.exports = Email;

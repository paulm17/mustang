import { MailAccount, TLSSocketType } from "../MailAccount";
import type { EMail } from "../EMail";
import type { PersonUID } from "../../Abstract/PersonUID";
import { Attachment , ContentDisposition } from "../Attachment";
import { appGlobal } from "../../app";
import { blobToBase64 } from "../../util/util";
import type { ArrayColl } from "svelte-collections";
import type { Attachment as NMAttachment, Address as NMAddress } from "@types/nodemailer/lib/mailer";
import type Mail from "@types/nodemailer/lib/mailer";
type NMMail = Mail.Options;

export class SMTPAccount extends MailAccount {
  readonly protocol: string = "smtp";

  protected getTransportOptions() {
    return {
      host: this.hostname,
      port: this.port,
      secure: this.tls == TLSSocketType.TLS,
      tls: {
        requireTLS: this.tls == TLSSocketType.STARTTLS,
      },
      auth: {
        user: this.username,
        pass: this.password,
        // TODO type: 'oauth2',
      },
      dnsTimeout: 5000,
      connectionTimeout: 5000,
      greetingTimeout: 20000,
      logger: true,
      disableFileAccess: true,
      disableUrlAccess: true,
    };
  }

  async send(email: EMail): Promise<void> {
    try {
      let mail = await SMTPAccount.getNMMail(email);
      let result = await appGlobal.remoteApp.sendMailNodemailer(
        this.getTransportOptions(), mail);
      email.sent = new Date();
      email.received = email.sent;
      email.mime = await appGlobal.remoteApp.getMIMENodemailer(mail); // to save the Sent mail

      // Send copy to myself, via SMTP - Workaround for IMAP.addMessage() not working
      // <https://nodemailer.com/smtp/envelope/>
      mail.envelope = {};
      mail.envelope.to = this.emailAddress;
      await appGlobal.remoteApp.sendMailNodemailer(
        this.getTransportOptions(), mail);
    } catch (ex) {
      if (ex.code == "EAUTH") {
        ex.message = "Check your login, username, and password:\n" + ex.message;
        ex.authFail = true;
      }
      throw ex;
    }
  }

  static async getNMMail(email: EMail): Promise<NMMail> {
    return {
      subject: email.subject,
      inReplyTo: email.inReplyTo,
      from: SMTPAccount.getRecipient(email.from),
      replyTo: email.replyTo ? SMTPAccount.getRecipient(email.replyTo) : null,
      to: SMTPAccount.getRecipients(email.to),
      cc: SMTPAccount.getRecipients(email.cc),
      bcc: SMTPAccount.getRecipients(email.bcc),
      text: email.text,
      html: email.html,
      attachDataUrls: true,
      attachments: await SMTPAccount.getAttachments(email),
      disableFileAccess: true,
      disableUrlAccess: true,
    };
  }

  static async getMIME(email: EMail): Promise<Uint8Array> {
    let mail = await SMTPAccount.getNMMail(email);
    return await appGlobal.remoteApp.getMIMENodemailer(mail);
  }

  async verifyLogin(): Promise<void> {
    try {
      await appGlobal.remoteApp.verifyServerNodemailer(this.getTransportOptions());
    } catch (ex) {
      if (ex.code == "EAUTH") {
        ex.message = "Check your login, username, and password:\n" + ex.message;
        ex.authFail = true;
      }
      throw ex;
    }
  }

  protected static getRecipients(recipients: ArrayColl<PersonUID>): NMAddress[] {
    return recipients.contents.map(to => SMTPAccount.getRecipient(to));
  }
  protected static getRecipient(to: PersonUID): NMAddress {
    // `${to.name} <${to.emailAddress}>` created by nodemailer, with quotes
    return {
      name: to.name,
      address: to.emailAddress,
    };
  }
  protected static async getAttachments(email: EMail): Promise<NMAttachment[]> {
    return await Promise.all(email.attachments.contents.map((a) => SMTPAccount.getAttachment(a)));
  }
  protected static async getAttachment(a: Attachment): Promise<NMAttachment> {
    return {
      filename: a.filename,
      content: await blobToBase64(a.content),
      encoding: "base64",
      contentType: a.mimeType,
      contentDisposition: a.disposition == ContentDisposition.inline ? 'inline' : 'attachment',
      cid: a.contentID,
    };
  }
}

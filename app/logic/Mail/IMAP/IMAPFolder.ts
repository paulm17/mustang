import { Folder } from "../Folder";
import { IMAPEMail } from "./IMAPEMail";
import type { IMAPAccount } from "./IMAPAccount";
import { ArrayColl } from "svelte-collections";

export class IMAPFolder extends Folder {
  _account: IMAPAccount;
  path: string;

  constructor(account: IMAPAccount) {
    super();
    this._account = account;
  }

  fromFlow(folderInfo: any) {
    this.name = folderInfo.name;
    this.path = folderInfo.path;
    this.specialUse(folderInfo.specialUse);
  }

  async listMessages() {
    let lock;
    try {
      console.log("list messages in folder", this.name);
      let newMessages = new ArrayColl<IMAPEMail>();
      let conn = this._account._connection;
      lock = await conn.getMailboxLock(this.path);
      let msgsAsyncIterator = await conn.fetch({ all: true }, {
        size: true,
        threadId: true,
        internalDate: true,
        envelope: true,
      });
      for await (let msgInfo of msgsAsyncIterator) {
        let msg = this.getEMailByUID(msgInfo.uid);
        if (!msg) {
          msg = new IMAPEMail(this);
          msg.fromFlow(msgInfo);
          console.log("Message", msg, msgInfo);
          newMessages.add(msg);
        }
      }
      this.messages.addAll(newMessages); // notify only once
    } finally {
      lock.release();
    }
    await this.downloadMessagesComplete();
  }

  async downloadMessagesComplete() {
    let lock;
    try {
      console.log("download complete messages in folder", this.name);
      let newMessages = new ArrayColl<IMAPEMail>();
      let conn = this._account._connection;
      lock = await conn.getMailboxLock(this.path);
      for await (let msgInfo of await conn.fetch({ all: true }, {
        size: true,
        threadId: true,
        envelope: true,
        source: true,
        headers: true,
      })) {
        let msg = this.getEMailByUID(msgInfo.uid);
        if (msg?.downloadComplete) {
          continue;
        } else if (msg) {
          msg.fromFlow(msgInfo);
        } else {
          msg = new IMAPEMail(this);
          msg.fromFlow(msgInfo);
          msg.downloadComplete = true;
          newMessages.add(msg);
        }
        console.log("Message complete", msg, msgInfo);
      }
      this.messages.addAll(newMessages); // notify only once
    } finally {
      lock.release();
    }
  }

  getEMailByUID(uid: number): IMAPEMail {
    return this.messages.find((m: IMAPEMail) => m.uid == uid) as IMAPEMail;
  }

  /* getEMailByUIDOrCreate(uid: number): IMAPEMail {
    return this.getEMailByUID(uid) ?? new IMAPEMail(this);
  }*/

  specialUse(specialUse: string): void {
    switch (specialUse) {
      case "\Inbox":
        this._account.inbox = this;
        break;
      case "\Trash":
        this._account.trash = this;
        break;
      case "\Junk":
        this._account.spam = this;
        break;
      case "\Sent":
        this._account.sent = this;
        break;
      case "\Drafts":
        this._account.drafts = this;
        break;
      case "\Archive":
        this._account.archive = this;
        break;
    }
  }
}

import { session as Session, BrowserWindow, net as Net } from "electron";
import { Readable } from 'stream';

const kCanaryName = "X-OWA-CANARY";
const kHotmailServer = "outlook.live.com";

export async function fetchSessionData(partition: string, url: string, interactive?: boolean, autoFillLoginPage?: string) {
  let session = Session.fromPartition(partition);
  let response = await session.fetch(url + 'sessiondata.ashx', { method: 'POST' });
  if ([401, 440].includes(response.status) && interactive) {
    return await new Promise(resolve => {
      let urlObj = new URL(url);
      // We want to skip the landing page for personal Microsoft accounts.
      let isHotmail = urlObj.hostname == kHotmailServer;
      if (isHotmail) {
        url = url + "?nlp=1";
      }
      let popup = new BrowserWindow({
        //parent: mainWindow,
        //modal: true,
        center: true,
        autoHideMenuBar: true,
        webPreferences: {
          session,
          // Security
          sandbox: true,
          disableHtmlFullscreenWindowResize: true,
          webgl: false,
          autoplayPolicy: "user-gesture-required",
        },
      });
      let finished = false;
      let finish = function(data) {
        if (finished) {
          return;
        }
        finished = true;
        session.cookies.removeListener('changed', onCookie);
        resolve(data);
        if (!popup.isDestroyed()) {
          popup.destroy();
        }
      };
      let checkLoginFinished = async function() {
        try {
          url = urlObj.href;
          response = await session.fetch(url + 'sessiondata.ashx', { method: 'POST' });
          let json = await response.json();
          if (isHotmail) {
            json.owaURL = url;
          }
          finish(json);
        } catch (ex) {
        }
      }
      let onCookie = async function (_event, cookie, _cause, removed) {
        try {
          if (removed) {
            return;
          }
          // For Hotmail, check the path to the CANARY cookie.
          if (cookie.domain == kHotmailServer &&
            cookie.name == kCanaryName &&
            cookie.path?.startsWith("/owa/")) {
            // Hotmail also sets cookies for /owa/0/, /mail/0/, /calendar/0/ etc.,
            // but we can use only the /owa/0/ cookie.
            // We also need to use that URL for the service request.
            // This needs to happen before CheckLoginFinished().
            urlObj.hostname = cookie.domain;
            urlObj.pathname = cookie.path;
            isHotmail = true;
          }
          // If we receive the canary cookie, check whether we're logged in
          if (cookie.name == kCanaryName &&
            cookie.domain == urlObj.hostname) {
            await checkLoginFinished();
          }
        } catch (ex) {
          console.error(ex);
        }
      };
      let checkLoaded = async function(_event) {
        let cookies = await Session.fromPartition(partition).cookies.get({ name: kCanaryName });
        if (cookies[0]?.value) {
          await checkLoginFinished();
        } else if (autoFillLoginPage) {
          try {
            await popup.webContents.executeJavaScript(autoFillLoginPage);
          } catch (ex) {
            console.error(ex);
          }
        }
      };
      session.cookies.on('changed', onCookie);
      popup.on('closed', function() { finish(null); });
      popup.webContents.on('did-stop-loading', checkLoaded);
      popup.loadURL(url);
    });
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

export async function fetchJSON(partition: string, url: string, action: string, request: any) {
  let result = {
    ok: false,
    status: 0,
    statusText: '',
    url: '',
    contentType: '',
    json: null,
  };
  let session = Session.fromPartition(partition);
  let cookies = await session.cookies.get({ name: kCanaryName });
  if (!cookies.length) {
    result.status = 401;
    return result;
  }
  let options = {
    method: "POST",
    headers: {},
  };
  options.headers[kCanaryName] = cookies[0].value;
  if (action) {
    options.headers.Action = action;
  }
  if (request) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(request);
  }
  let response = await session.fetch(url, options);
  result.ok = response.ok;
  result.status = response.status;
  result.statusText = response.statusText;
  result.url = response.url;
  result.contentType = response.headers.get('Content-Type');
  result.json = await response.json();
  return result;
}

/**
 * Fetches an HTTPS URL using a specific electron partition.
 * @param partition {string}
 * @param url       {string}
 * @param data?     {Dict<string>}
 *
 * TODO: Use options parameter, which can contain:
 * - body {Dict<string>|Buffer|string}
 * - cache {'default'|'no-store'|'reload'|'no-cache'|'force-cache'}
 * - credentials {'include'|'omit'|'same-origin'} [currently always 'include']
 * - headers {Dict<string>}
 * - method {string} [currently autodetects 'GET' or 'POST']
 * - origin {string}
 * - redirect {'follow'|'manual'|'error'} [currently always 'follow']
 * - result {'text'|'bytes'|'json'|'stream'} [currently always 'text']
 */
export async function fetchText(partition: string, url: string, data?: Dict<string>) {
  //console.log("fetchText partition", partition, "URL", url, "Data", data);
  return new Promise((resolve, reject) => {
    let options = {
      method: data ? 'POST' : 'GET',
      url: url,
      partition: partition,
      credentials: 'include',
      redirect: 'manual',
    };
    let request = Net.request(options);
    request.on('response', message => {
      if ([101, 204, 205, 304].includes(message.statusCode)) {
        resolve({
          ok: (message.statusCode >= 200 && message.statusCode <= 299),
          status: message.statusCode,
          statusText: message.statusMessage,
          text: '',
          url: url,
        });
      } else {
        new Response(Readable.toWeb(message)).text().then(text => resolve({
          ok: (message.statusCode >= 200 && message.statusCode <= 299),
          status: message.statusCode,
          statusText: message.statusMessage,
          text: text,
          url: url,
        })).catch(reject);
      }
    });
    request.on('error', reject);
    request.on('redirect', (statusCode, method, redirectUrl, responseHeaders) => {
      url = redirectUrl;
      request.followRedirect();
    });
    request.end(data ? new URLSearchParams(data).toString() : '');
  });
}

export async function streamJSON(partition: string, url: string) {
  let result = {
    ok: false,
    status: 0,
    statusText: '',
    body: null,
  };
  let session = Session.fromPartition(partition);
  let cookies = await session.cookies.get({ name: kCanaryName });
  if (!cookies.length) {
    result.status = 401;
    return result;
  }
  let response = await session.fetch(url + cookies[0].value);
  result.ok = response.ok;
  result.status = response.status;
  result.statusText = response.statusText;
  result.body = response.body.pipeThrough(new TextDecoderStream());
  return result;
}

export async function clearStorageData(partition: string) {
  await Session.fromPartition(partition).clearStorageData();
}

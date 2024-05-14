import { assert, AbstractFunction } from "../util/util";
import { OAuth2UI } from "./OAuth2UI";

/**
 * Opens a new window for OAuth2 login,
 * monitors the process and returns the `authCode`.
 */
export class OAuth2Window extends OAuth2UI {
  /**
   * Does an interactive login
   * @returns authCode
   * @throws OAuth2Error
   */
  async login(): Promise<string> {
    let state = Math.random().toString().slice(2);
    let url = this.oAuth2.getAuthURL(state);
    let popup = window.open(url, "_blank", "center,oauth2popup") as Window;
    assert(popup, "Failed to open OAuth2 window");
    return await new Promise((resolve, reject) => {
      let ipcRenderer = (window as any).electron.ipcRenderer; // TODO use JPC, or remove window
      let handleNavigation = (event, value) => {
        let url = new URL(value);
        let parameters = Object.fromEntries(url.searchParams);
        url.hash = url.search = "";
        if (url.href.startsWith(this.oAuth2.authDoneURL) && parameters.state == state) {
          ipcRenderer.removeListener('oauth2-navigate', handleNavigation);
          ipcRenderer.removeListener('oauth2-close', handleClose);
          popup.close();
          if (parameters.code) {
            resolve(parameters.code);
          } else {
            reject(new OAuth2ErrorMS(parameters));
          }
        }
      }
      let handleClose = (event, value) => {
        if (popup.closed) {
          ipcRenderer.removeListener('oauth2-navigate', handleNavigation);
          ipcRenderer.removeListener('oauth2-close', handleClose);
          reject(new Error("Authentication window was closed by user"));
        }
      }
      ipcRenderer.on('oauth2-navigate', handleNavigation);
      ipcRenderer.on('oauth2-close', handleClose);
    });
  }
}

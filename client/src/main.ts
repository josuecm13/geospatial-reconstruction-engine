import "@fontsource-variable/inter";
import "./style.css";
import { ApiClient } from "./api/client";
import { CurrentArea } from "./importing/recentImports";
import { startPages } from "./pages/host";
import { createRouter } from "./routing/router";
import { legacyRedirect } from "./routing/routes";

const api = new ApiClient();

// Links from before there were pages (`/#map`, `/#scene`) go to the remembered area, or to the locations.
const legacy = location.pathname === "/" ? legacyRedirect(location.hash, new CurrentArea(localStorage).id) : null;
if (legacy) history.replaceState(null, "", legacy);

const router = createRouter();
startPages(document.getElementById("page")!, document.getElementById("page-tabs")!, { api, router });

// The header's site links show where we are.
const siteLinks = document.querySelectorAll<HTMLAnchorElement>("a[data-page]");
const markCurrent = () => {
  for (const link of siteLinks) link.setAttribute("aria-current", String(link.dataset.page === router.get().page));
};
router.subscribe(markCurrent);
markCurrent();

const status = document.getElementById("api-status")!;
const statusTip = document.getElementById("api-tip")!;
api.health().then(
  () => {
    status.textContent = "API ok";
    status.dataset.state = "ok";
    statusTip.textContent = "The API answered its health check.";
  },
  (error) => {
    status.textContent = "API unreachable";
    status.dataset.state = "down";
    statusTip.textContent = `The API did not answer its health check: ${String(error.message ?? error)}`;
  },
);

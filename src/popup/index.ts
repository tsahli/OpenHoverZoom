import { loadSettings, saveSettings, siteFromUrl } from "../shared/settings";

const enabledInput = requiredElement<HTMLInputElement>("enabled");
const siteButton = requiredElement<HTMLButtonElement>("site-toggle");
const status = requiredElement<HTMLElement>("status");

void initialize();

async function initialize(): Promise<void> {
  let settings = await loadSettings();
  enabledInput.checked = settings.enabled;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const site = activeTab?.url ? siteFromUrl(activeTab.url) : null;

  if (site) {
    siteButton.disabled = false;
    updateSiteButton(site, settings.disabledSites.includes(site));
    siteButton.addEventListener("click", () => {
      void (async () => {
        const disabled = settings.disabledSites.includes(site);
        settings = {
          ...settings,
          disabledSites: disabled
            ? settings.disabledSites.filter((entry) => entry !== site)
            : [...settings.disabledSites, site].sort(),
        };
        await saveSettings(settings);
        updateSiteButton(site, !disabled);
        status.textContent = disabled ? "Previews enabled for this site." : "Previews disabled here.";
      })();
    });
  } else {
    siteButton.textContent = "Site controls unavailable";
  }

  enabledInput.addEventListener("change", () => {
    void (async () => {
      settings = { ...settings, enabled: enabledInput.checked };
      await saveSettings(settings);
      status.textContent = enabledInput.checked ? "Previews enabled." : "Previews paused.";
    })();
  });
}

function updateSiteButton(site: string, disabled: boolean): void {
  siteButton.textContent = `${disabled ? "Enable" : "Disable"} on ${site}`;
}

function requiredElement<ElementType extends HTMLElement>(id: string): ElementType {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as ElementType;
}

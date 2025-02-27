import * as React from "react";
import useSWR from "swr";

import { DISABLE_AUTH, DEFAULT_GEO_COUNTRY } from "./env";
import { MDNWorker } from "./settings/mdn-worker";

export enum SubscriptionType {
  MDN_CORE = "",
  MDN_PLUS_5M = "mdn_plus_5m",
  MDN_PLUS_5Y = "mdn_plus_5y",
  MDN_PLUS_10M = "mdn_plus_10m",
  MDN_PLUS_10Y = "mdn_plus_10y",
}

export type UserPlusSettings = {
  colInSearch: boolean;
};

export type UserData = {
  username: string | null | undefined;
  isAuthenticated: boolean;
  isBetaTester: boolean;
  isContributor?: boolean; // This is not implemented on backend yet
  isStaff: boolean;
  isSuperuser: boolean;
  avatarUrl: string | null | undefined;
  isSubscriber: boolean;
  subscriberNumber: number | null | undefined;
  subscriptionType: SubscriptionType | null;
  email: string | null | undefined;
  geo: {
    country: string;
  };
  maintenance?: string;
  settings: null | UserPlusSettings;
  mdnWorker?: MDNWorker;
  mutate: () => void;
};

export const UserDataContext = React.createContext<UserData | null>(null);

// The argument for using sessionStorage rather than localStorage is because
// it's marginally simpler and "safer". For example, if we use localStorage
// it might stick in the browser for a very long time and we might change
// the structure of that JSON we store in there.
// Also, localStorage doesn't go away. So if we decide to not do this stuff
// anymore we won't have users who have that stuff stuck in their browser
// "forever".
const SESSION_STORAGE_KEY = "whoami";

function getSessionStorageData() {
  try {
    const data = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      // Because it was added late, if the stored value doesn't contain
      // then following keys, consider the stored data stale.
      if (!parsed.geo) {
        // If we don't do this check, you might be returning stored data
        // that doesn't match any of the new keys.
        return false;
      }
      return parsed as UserData;
    }
  } catch (error: any) {
    console.warn("sessionStorage.getItem didn't work", error.toString());
    return null;
  }
}

export function cleanupUserData() {
  removeSessionStorageData();
  if (window.mdnWorker) {
    window.mdnWorker.cleanDb();
    window.mdnWorker.disableServiceWorker();
  }
}

function removeSessionStorageData() {
  try {
    // It's safe to call .removeItem() on a key that doesn't already exist,
    // and it's pointless to first do a .hasItem() before the .removeItem()
    // because internally that's what .removeItem() already does.
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (error: any) {
    console.warn("sessionStorage.removeItem didn't work", error.toString());
  }
}

function setSessionStorageData(data: UserData) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
  } catch (error: any) {
    console.warn("sessionStorage.setItem didn't work", error.toString());
  }
}

export function UserDataProvider(props: { children: React.ReactNode }) {
  const { data, mutate } = useSWR<UserData | null, Error | null>(
    DISABLE_AUTH ? null : "/api/v1/whoami",
    async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        removeSessionStorageData();
        throw new Error(`${response.status} on ${response.url}`);
      }
      const data = await response.json();
      const settings: UserPlusSettings | null = data.settings
        ? {
            colInSearch: data.settings.col_in_search || false,
          }
        : null;

      return {
        username: data.username || null,
        isAuthenticated: data.is_authenticated || false,
        isBetaTester: data.is_beta_tester || false,
        isStaff: data.is_staff || false,
        isSuperuser: data.is_super_user || false,
        avatarUrl: data.avatar_url || null,
        isSubscriber: data.is_subscriber || false,
        subscriptionType:
          data.subscription_type === "core"
            ? SubscriptionType.MDN_CORE
            : data.subscription_type ?? null,
        subscriberNumber: data.subscriber_number || null,
        email: data.email || null,
        geo: {
          country: (data.geo && data.geo.country) || DEFAULT_GEO_COUNTRY,
        },
        maintenance: data.maintenance,
        settings,
        mutate,
      };
    }
  );

  React.useEffect(() => {
    if (data) {
      // At this point, the XHR request has set `data` to be an object.
      // The user is definitely signed in or not signed in.
      setSessionStorageData(data);

      // Let's initialize the MDN Worker if the user is signed in.
      if (!window.mdnWorker && data?.isAuthenticated) {
        import("./settings/mdn-worker").then(({ getMDNWorker }) => {
          const mdnWorker = getMDNWorker();
          if (data?.isSubscriber === false) {
            mdnWorker.clearOfflineSettings();
          }
        });
      } else if (window.mdnWorker) {
        if (data?.isAuthenticated === false) {
          window.mdnWorker.disableServiceWorker();
        } else if (data?.isSubscriber === false) {
          window.mdnWorker.clearOfflineSettings();
        }
      }
    }
  }, [data]);

  let userData = data || getSessionStorageData();
  if (userData && window?.mdnWorker) {
    userData.mdnWorker = window.mdnWorker;
  }

  return (
    <UserDataContext.Provider value={userData || null}>
      {props.children}
    </UserDataContext.Provider>
  );
}

export function useUserData() {
  return React.useContext(UserDataContext);
}

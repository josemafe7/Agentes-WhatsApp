// Serializable data the server layout hands to the client parts of the shell (never secrets).

export type ShellBusiness = {
  name: string;
  initials: string;
  /** Authenticated file route of the logo, or null to show the initials. */
  logoUrl: string | null;
};

export type ShellUser = {
  name: string;
  email: string;
  roleLabel: string;
};

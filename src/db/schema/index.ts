// Every table of the product, split by domain. drizzle-kit reads this file (drizzle.config.ts).
export * from "./auth";
export * from "./users";
export * from "./settings";
export * from "./agents";
export * from "./channels";
export * from "./contacts";
export * from "./conversations";
export * from "./knowledge";
export * from "./agenda";
// Prepared, not offered yet: services that need two resources at once ([AGD-07]).
export * from "./agenda-prepared";
export * from "./operations";

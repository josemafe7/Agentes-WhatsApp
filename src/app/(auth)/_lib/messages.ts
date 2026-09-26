// Texts the sign-in flows show. Generic on purpose: they never say whether an email has an account
// ([USU-01], [USU-10], [SEG-14]).

export const INVALID_CREDENTIALS_MESSAGE = "Email o contraseña incorrectos";
export const TOO_MANY_ATTEMPTS_MESSAGE = "Demasiados intentos. Espera unos minutos.";
export const ACCOUNT_DISABLED_MESSAGE = "Tu cuenta está desactivada. Pide al propietario que la vuelva a activar.";
export const GENERIC_ERROR_MESSAGE = "Algo ha fallado. Inténtalo de nuevo.";

export const RESET_REQUESTED_MESSAGE = "Si el email existe, te hemos enviado un enlace.";
export const RESET_LINK_INVALID_MESSAGE = "Este enlace ya no es válido: ha caducado o ya se ha usado. Pide otro.";
export const PASSWORD_CHANGED_NOTICE = "Contraseña cambiada. Entra con la nueva.";

/** Notices /login shows from its ?aviso= parameter. */
export const LOGIN_NOTICES = { "contrasena-cambiada": PASSWORD_CHANGED_NOTICE } as const;
export type LoginNotice = keyof typeof LOGIN_NOTICES;

export const TWO_FACTOR_INVALID_CODE_MESSAGE = "El código no es correcto. Prueba con el que te muestre ahora la app.";
export const TWO_FACTOR_INVALID_BACKUP_MESSAGE = "Ese código de recuperación no es válido o ya se ha usado.";
export const TWO_FACTOR_EXPIRED_MESSAGE = "La verificación ha caducado. Vuelve a iniciar sesión.";

export const PASSWORDS_DIFFER_MESSAGE = "Las contraseñas no coinciden.";

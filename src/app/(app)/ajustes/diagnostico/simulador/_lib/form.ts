// The simulator form as the data layer takes it (src/data/simulator.ts validates it again, [SEG-05]). Pure.
export type SimulatorUpload = { bytes: Uint8Array; fileName: string };

const text = (formData: FormData, name: string): string | undefined => {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};

/** FormData → the input of simulateInboundMessage. Empty fields are left out; the file only goes with a file type. */
export function simulatorInputFromFormData(formData: FormData, upload: SimulatorUpload | null) {
  const contentType = text(formData, "contentType") ?? "text";
  return {
    channelId: text(formData, "channelId"),
    contact:
      text(formData, "contactMode") === "existing"
        ? { mode: "existing", contactId: text(formData, "contactId") }
        : { mode: "new", name: text(formData, "name"), phone: text(formData, "phone"), email: text(formData, "email") },
    contentType,
    text: text(formData, "text"),
    subject: text(formData, "subject"),
    ...(contentType === "text" ? {} : { file: upload ? { source: "upload", bytes: upload.bytes, fileName: upload.fileName } : { source: "sample" } }),
  };
}

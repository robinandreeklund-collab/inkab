/**
 * Dataformatet när en maskin dras ur katalogen och släpps i ritningen.
 *
 * Ett eget format i stället för `text/plain`: släpper någon in text från en
 * annan flik ska ingen maskin dyka upp, och drar man en maskin till ett
 * textfält ska dess namn hamna där — inte ett id.
 */
export const MACHINE_DRAG_TYPE = "application/x-inkab-machine";

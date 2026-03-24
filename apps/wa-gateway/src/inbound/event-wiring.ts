interface InboundEventWiringInput {
  socket: any;
  onMessagesUpsert: (payload: any) => Promise<void>;
  onGroupParticipantsUpdate: (update: any) => Promise<void>;
}

export const wireInboundEvents = (input: InboundEventWiringInput) => {
  const { socket, onMessagesUpsert, onGroupParticipantsUpdate } = input;
  (socket.ev as any).on("group-participants.update", onGroupParticipantsUpdate);
  socket.ev.on("messages.upsert", onMessagesUpsert);
};

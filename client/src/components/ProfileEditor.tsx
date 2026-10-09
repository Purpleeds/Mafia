import { useState, type FormEvent } from "react";
import { validateNickname, type Avatar, type AvatarView, type GameView, type UpdateProfilePayload } from "@mafia/shared";
import { saveProfile } from "../lib/storage";
import { useAction } from "../lib/useAction";
import { call } from "../net/socket";
import { AvatarBadge } from "./AvatarBadge";
import { AvatarPicker } from "./AvatarPicker";
import { ErrorText } from "./ErrorText";
import { NicknameField } from "./NicknameField";
import { RoomPhotoControls } from "./PhotoControls";

/** Lobby only: change your nickname, drawn avatar and picture. */
export function ProfileEditor({ name, avatar, view }: { name: string; avatar: AvatarView; view: GameView }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card" aria-labelledby="profile-title">
      <div className="card-header">
        <h2 id="profile-title" className="card-title">
          You
        </h2>
        {!open ? (
          <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>
            Edit
          </button>
        ) : null}
      </div>
      {open ? (
        <ProfileForm initialName={name} initialAvatar={{ color: avatar.color, seed: avatar.seed }} onDone={() => setOpen(false)} />
      ) : (
        <div className="profile-summary">
          <AvatarBadge avatar={avatar} size={48} />
          <span className="profile-name">{name}</span>
        </div>
      )}
      <RoomPhotoControls view={view} />
    </section>
  );
}

function ProfileForm({
  initialName,
  initialAvatar,
  onDone,
}: {
  initialName: string;
  initialAvatar: Avatar;
  onDone: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [nameError, setNameError] = useState<string | null>(null);
  const action = useAction();
  const check = validateNickname(name);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!check.ok) return;
    const patch: UpdateProfilePayload = {};
    if (check.value !== initialName) patch.name = check.value;
    if (avatar.color !== initialAvatar.color || avatar.seed !== initialAvatar.seed) patch.avatar = avatar;
    if (patch.name === undefined && patch.avatar === undefined) {
      onDone();
      return;
    }
    const result = await action.run(() => call("player:updateProfile", patch));
    if (result.ok) {
      saveProfile({ name: check.value, avatar });
      onDone();
    } else if (result.error.code === "NAME_TAKEN" || result.error.code === "INVALID_NAME") {
      setNameError(
        result.error.code === "NAME_TAKEN" ? "Someone in this room already has that nickname." : result.error.message,
      );
      action.clearError();
    }
  };

  return (
    <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
      <NicknameField
        id="profile-name"
        value={name}
        onChange={(v) => {
          setName(v);
          setNameError(null);
        }}
        serverError={nameError}
        showValidation
      />
      <AvatarPicker idPrefix="profile-avatar" value={avatar} onChange={setAvatar} />
      <ErrorText error={action.error} />
      <div className="button-row">
        <button type="submit" className="btn btn-primary" disabled={action.pending || !check.ok}>
          {action.pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

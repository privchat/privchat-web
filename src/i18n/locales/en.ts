// English (default fallback for vi until proper translations land).
//
// `as const` would freeze every leaf into a string-literal type, forcing
// other locales to use the same English literal. We want the SHAPE
// pinned but each leaf to accept any string — so we apply the schema
// type explicitly without `as const`.
export const en: LocaleSchema = {
  app: {
    name: 'PrivChat',
    loading: 'Loading…',
    system_notifications: 'System Notifications',
    unknown_user: 'User #{{id}}',
    unknown_group: 'Group #{{id}}',
  },
  login: {
    title: 'PrivChat',
    description: 'Sign in to continue, or create a new account.',
    gateway_url: 'Gateway URL',
    username: 'Username',
    password: 'Password',
    login: 'Login',
    register: 'Register',
    signing_in: 'Signing in…',
    error_login: 'login: {{message}}',
    error_register: 'register: {{message}}',
    mobile_label: 'Mobile',
    mobile_placeholder: '+8613800138000',
    sms_code_label: 'Verification code',
    sms_code_placeholder: 'Enter the 6-digit code',
    send_sms_code: 'Send code',
    resend_sms_code: 'Resend in {{seconds}}s',
    sending_sms_code: 'Sending…',
    sms_code_hint: 'The code is valid for 5 minutes.',
    // Telegram-style two-step phone → OTP flow (replaces single-page form):
    continue: 'Continue',
    country_label: 'Country',
    phone_number_label: 'Phone number',
    phone_number_placeholder: 'Your phone number',
    otp_step_title: 'Enter the code',
    otp_step_subtitle: 'We sent a code to {{mobile}}',
    otp_back: 'Back',
    otp_resend_now: 'Resend code',
    error_invalid_mobile: 'Please enter a valid mobile number, e.g. +8613800138000',
    error_send_sms: 'Send code: {{message}}',
    error_sms_login: 'SMS login: {{message}}',
    error_network: 'Network error. Please try again later.',
    error_protocol: 'Unexpected response from server. Please try again later.',
    error_config: 'Platform configuration error. Contact your administrator.',
    qr_tab: 'Scan QR',
    sms_tab: 'SMS',
    qr_loading: 'Generating QR code…',
    qr_waiting_title: 'Scan with PrivChat',
    qr_waiting_subtitle: 'Open PrivChat on your phone, tap "Scan", and point at this QR code.',
    qr_expires_in: 'Expires in {{seconds}}s',
    qr_scanned_title: 'QR scanned',
    qr_scanned_subtitle: 'Tap "Confirm" on your phone to finish signing in.',
    qr_authorizing: 'Signing in…',
    qr_rejected_title: 'Login rejected',
    qr_rejected_subtitle: 'You declined the sign-in request on your phone.',
    qr_expired_title: 'QR code expired',
    qr_expired_subtitle: 'Generate a new code to try again.',
    qr_regenerate: 'Generate new code',
    qr_error_title: 'Could not start QR login',
    qr_canvas_alt: 'QR login code',
  },
  onboarding: {
    splash_loading: 'Checking your account…',
    complete_profile: {
      title: 'Welcome to PrivChat',
      subtitle: 'Choose a nickname so your friends can recognize you.',
      nickname_label: 'Nickname',
      nickname_placeholder: 'Between 2 and 32 characters',
      submit: 'Enter chat',
      submitting: 'Saving…',
      error_required: 'Please enter a nickname',
      error_too_short: 'Nickname must be at least 2 characters',
      error_too_long: 'Nickname must be at most 32 characters',
      error_network: 'Network error. Please try again later.',
      error_protocol: 'Unexpected response from server. Please try again later.',
      error_config: 'Configuration error. Contact your administrator.',
    },
    unsupported: {
      title: 'Client update required',
      message: 'Your account needs to complete "{{title}}", but the current build does not support it yet. Please update PrivChat to continue.',
      message_fallback: 'Your account needs to complete a required action that the current build does not support yet. Please update PrivChat to continue.',
      reload: 'I updated, reload now',
      logout: 'Sign out',
    },
  },
  requiredAction: {
    completeProfile: {
      nickname: 'Set your nickname',
    },
  },
  profile_edit: {
    title: 'Edit profile',
    open_button: 'Edit profile',
    nickname_label: 'Nickname',
    bio_label: 'Bio',
    bio_placeholder: 'A short bio (up to 200 characters)',
    gender_label: 'Gender',
    gender_unknown: 'Prefer not to say',
    gender_male: 'Male',
    gender_female: 'Female',
    gender_other: 'Other',
    birthday_label: 'Birthday',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    saved: 'Saved.',
    error_nickname_too_short: 'Nickname must be at least 2 characters',
    error_nickname_too_long: 'Nickname must be at most 32 characters',
    error_bio_too_long: 'Bio must be at most 200 characters',
    error_birthday_format: 'Birthday must be YYYY-MM-DD',
    error_network: 'Network error. Please try again later.',
    error_protocol: 'Unexpected response from server. Please try again later.',
    error_config: 'Configuration error. Contact your administrator.',
    error_load: 'Failed to load profile. Please try again.',
    avatar_pick: 'Choose image',
    avatar_hint: 'JPEG / PNG / WebP, up to 5 MB',
    avatar_error_mime: 'Avatar must be JPEG, PNG, or WebP',
    avatar_error_size: 'Avatar must be 5 MB or smaller',
  },
  workspace: {
    logout: 'Logout',
    conversations: 'Conversations',
    refresh: 'Refresh',
    no_conversations: 'No conversations yet.',
    select_conversation: 'Select a conversation to start chatting.',
  },
  channel_actions: {
    pin: 'Pin',
    unpin: 'Unpin',
    mute: 'Mute',
    unmute: 'Unmute',
    hide: 'Hide',
    hide_confirm: 'Hide this conversation?',
    failed: 'Action failed',
    revoked_preview: '[Recalled]',
  },
  notify: {
    new_message: 'New message',
    sound_label: 'Notification sound',
    desktop_label: 'Desktop notifications',
    desktop_request: 'Enable desktop notifications',
    desktop_blocked: 'Desktop notifications were blocked by the browser.',
  },
  copy: {
    label: 'Copy',
    copied: 'Copied',
    user_id: 'User ID',
    username: 'Username',
  },
  logs: {
    open: 'Logs',
    title: 'Console logs',
    empty: 'No logs captured yet.',
    copy_all: 'Copy all',
    clear: 'Clear',
  },
  panel: {
    back: 'Back',
    type_message: 'Type a message…',
    send: 'Send',
    sending: 'sending…',
    opening: 'opening…',
    pending_count: '{{count}} pending',
    load_older: 'Load older',
    loading_older: 'loading…',
    beginning: '— beginning —',
    no_messages: 'No messages yet. Send the first one.',
    peer_typing: 'typing…',
    upload_image: 'Send image',
    upload_file: 'Send file',
    upload_failed: 'Upload failed',
    drop_to_upload: 'Drop file to send',
  },
  bot_menu: {
    button_label: 'Menu',
    title: 'Bot menu',
    loading: 'Loading…',
    empty: 'This bot has no menu configured',
    load_failed: 'Failed to load menu',
  },
  status: {
    pending: 'Sending',
    sent: 'Sent',
    read: 'Read',
    failed: 'Send failed',
    retry: 'Retry',
    discard: 'Discard',
    retrying: 'Retrying…',
  },
  message_actions: {
    revoke: 'Recall',
    revoke_confirm: 'Recall this message?',
    revoke_failed: 'Recall failed',
    revoked_self: 'You recalled a message',
    revoked_peer: '{{name}} recalled a message',
    revoked_unknown: 'Someone recalled a message',
    copy: 'Copy text',
    react: 'Add reaction',
    reaction_failed: 'Reaction failed',
    reply: 'Reply',
    replying_to: 'Replying to',
    cancel_reply: 'Cancel reply',
    reply_unavailable: '[Original message unavailable]',
    reply_out_of_window: 'Original message not loaded in this window',
  },
  theme: {
    system: 'Theme: follow system',
    light: 'Theme: light',
    dark: 'Theme: dark',
  },
  tabs: {
    chats: 'Chats',
    contacts: 'Contacts',
    groups: 'Groups',
  },
  accounts: {
    switcher_title: 'Accounts',
    switcher_aria: 'Switch account',
    switcher_unknown: 'Account',
    no_accounts: 'No accounts registered',
    add_account: 'Add account',
    cancel_add: 'Cancel',
  },
  contacts: {
    empty: 'No contacts yet.',
    opening: 'Opening…',
    pending_title: 'Friend Requests',
    find_title: 'Find People',
    find_placeholder: 'Search by username',
    find_no_results: 'No matches.',
    pending_empty: 'No pending requests.',
    accept: 'Accept',
    apply: 'Add',
    apply_message_label: 'Message (optional)',
    apply_send: 'Send Request',
    applied: 'Sent',
    chat: 'Chat',
    alias_label: 'Remark',
    alias_placeholder: 'Set a remark name',
    alias_save: 'Save',
    alias_clear: 'Clear',
    alias_failed: 'Could not save remark',
    remove_friend: 'Unfriend',
    remove_friend_confirm: 'Remove {{name}} from your contacts?',
    remove_friend_failed: 'Could not unfriend',
    block: 'Block',
    block_confirm: 'Block {{name}}? They will no longer be able to message you.',
    block_failed: 'Could not block',
  },
  groups: {
    empty: 'No groups yet.',
    create_title: 'Create Group',
    create_name: 'Group name',
    create_description: 'Description (optional)',
    create_submit: 'Create',
    info_title: 'Group Info',
    members: 'Members ({{count}})',
    members_loading: 'Loading members…',
    members_failed: 'Could not load members',
    leave: 'Leave Group',
    leave_confirm: 'Leave this group? You will no longer receive its messages.',
    leave_failed: 'Could not leave',
    role_owner: 'Owner',
    role_admin: 'Admin',
    add_member: 'Add Member',
    add_member_pick: 'Add member',
    add_member_no_friends: 'No friends available to add.',
    add_member_failed: 'Add member failed',
    add_member_added: 'Added',
    add_member_tab_friends: 'From friends',
    add_member_tab_search: 'Search',
    add_member_search_placeholder: 'Search by username, name, or mobile',
    add_member_search_hint: 'Type a username, display name, or mobile number to search.',
    add_member_search_empty: 'No matching users.',
    remove_member: 'Remove',
    remove_member_confirm: 'Remove {{name}} from the group?',
    remove_member_failed: 'Remove failed',
    mute_member: 'Mute',
    unmute_member: 'Unmute',
    muted_badge: 'Muted',
    mute_failed: 'Mute action failed',
    info_button: 'Group info',
    promote_admin: 'Make admin',
    demote_admin: 'Remove admin',
    set_role_failed: 'Role change failed',
    transfer_owner: 'Transfer ownership',
    transfer_owner_confirm:
      'Transfer group ownership to {{name}}? You will be downgraded to admin.',
    transfer_owner_failed: 'Transfer failed',
    settings_heading: 'Group settings',
    settings_edit: 'Edit',
    settings_edit_title: 'Edit group',
    settings_description: 'Description',
    settings_description_placeholder: 'Tell members what this group is for',
    settings_announcement: 'Announcement',
    settings_announcement_placeholder: 'Pinned at the top for new members',
    settings_mute_all: 'Mute everyone',
    settings_save: 'Save',
    settings_cancel: 'Cancel',
    settings_save_failed: 'Save failed',
    mute_all_failed: 'Mute-all toggle failed',
    mute_duration_title: 'Mute {{name}}',
    mute_duration_1h: '1 hour',
    mute_duration_1d: '1 day',
    mute_duration_7d: '7 days',
    mute_duration_30d: '30 days',
    mute_duration_forever: 'Forever',
  },
  connection: {
    connected: 'Connected',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
  },
  presence: {
    online: 'Online',
    offline: 'Offline',
    just_now: 'just now',
    minutes_ago: 'last seen {{count}}m ago',
    hours_ago: 'last seen {{count}}h ago',
    days_ago: 'last seen {{count}}d ago',
    long_ago: 'last seen {{date}}',
  },
};

export interface LocaleSchema {
  app: {
    name: string;
    loading: string;
    system_notifications: string;
    unknown_user: string;
    unknown_group: string;
  };
  login: {
    title: string;
    description: string;
    gateway_url: string;
    username: string;
    password: string;
    login: string;
    register: string;
    signing_in: string;
    error_login: string;
    error_register: string;
    mobile_label: string;
    mobile_placeholder: string;
    sms_code_label: string;
    sms_code_placeholder: string;
    send_sms_code: string;
    resend_sms_code: string;
    sending_sms_code: string;
    sms_code_hint: string;
    continue: string;
    country_label: string;
    phone_number_label: string;
    phone_number_placeholder: string;
    otp_step_title: string;
    otp_step_subtitle: string;
    otp_back: string;
    otp_resend_now: string;
    error_invalid_mobile: string;
    error_send_sms: string;
    error_sms_login: string;
    error_network: string;
    error_protocol: string;
    error_config: string;
    qr_tab: string;
    sms_tab: string;
    qr_loading: string;
    qr_waiting_title: string;
    qr_waiting_subtitle: string;
    qr_expires_in: string;
    qr_scanned_title: string;
    qr_scanned_subtitle: string;
    qr_authorizing: string;
    qr_rejected_title: string;
    qr_rejected_subtitle: string;
    qr_expired_title: string;
    qr_expired_subtitle: string;
    qr_regenerate: string;
    qr_error_title: string;
    qr_canvas_alt: string;
  };
  onboarding: {
    splash_loading: string;
    complete_profile: {
      title: string;
      subtitle: string;
      nickname_label: string;
      nickname_placeholder: string;
      submit: string;
      submitting: string;
      error_required: string;
      error_too_short: string;
      error_too_long: string;
      error_network: string;
      error_protocol: string;
      error_config: string;
    };
    unsupported: {
      title: string;
      message: string;
      message_fallback: string;
      reload: string;
      logout: string;
    };
  };
  requiredAction: {
    completeProfile: {
      nickname: string;
    };
  };
  profile_edit: {
    title: string;
    open_button: string;
    nickname_label: string;
    bio_label: string;
    bio_placeholder: string;
    gender_label: string;
    gender_unknown: string;
    gender_male: string;
    gender_female: string;
    gender_other: string;
    birthday_label: string;
    save: string;
    saving: string;
    cancel: string;
    saved: string;
    error_nickname_too_short: string;
    error_nickname_too_long: string;
    error_bio_too_long: string;
    error_birthday_format: string;
    error_network: string;
    error_protocol: string;
    error_config: string;
    error_load: string;
    avatar_pick: string;
    avatar_hint: string;
    avatar_error_mime: string;
    avatar_error_size: string;
  };
  workspace: {
    logout: string;
    conversations: string;
    refresh: string;
    no_conversations: string;
    select_conversation: string;
  };
  channel_actions: {
    pin: string;
    unpin: string;
    mute: string;
    unmute: string;
    hide: string;
    hide_confirm: string;
    failed: string;
    revoked_preview: string;
  };
  notify: {
    new_message: string;
    sound_label: string;
    desktop_label: string;
    desktop_request: string;
    desktop_blocked: string;
  };
  panel: {
    back: string;
    type_message: string;
    send: string;
    sending: string;
    opening: string;
    pending_count: string;
    load_older: string;
    loading_older: string;
    beginning: string;
    no_messages: string;
    peer_typing: string;
    upload_image: string;
    upload_file: string;
    upload_failed: string;
    drop_to_upload: string;
  };
  bot_menu: {
    button_label: string;
    title: string;
    loading: string;
    empty: string;
    load_failed: string;
  };
  status: {
    pending: string;
    sent: string;
    read: string;
    failed: string;
    retry: string;
    discard: string;
    retrying: string;
  };
  message_actions: {
    revoke: string;
    revoke_confirm: string;
    revoke_failed: string;
    revoked_self: string;
    revoked_peer: string;
    revoked_unknown: string;
    copy: string;
    react: string;
    reaction_failed: string;
    reply: string;
    replying_to: string;
    cancel_reply: string;
    reply_unavailable: string;
    reply_out_of_window: string;
  };
  theme: { system: string; light: string; dark: string };
  tabs: { chats: string; contacts: string; groups: string };
  accounts: {
    switcher_title: string;
    switcher_aria: string;
    switcher_unknown: string;
    no_accounts: string;
    add_account: string;
    cancel_add: string;
  };
  contacts: {
    empty: string;
    opening: string;
    pending_title: string;
    find_title: string;
    find_placeholder: string;
    find_no_results: string;
    pending_empty: string;
    accept: string;
    apply: string;
    apply_message_label: string;
    apply_send: string;
    applied: string;
    chat: string;
    alias_label: string;
    alias_placeholder: string;
    alias_save: string;
    alias_clear: string;
    alias_failed: string;
    remove_friend: string;
    remove_friend_confirm: string;
    remove_friend_failed: string;
    block: string;
    block_confirm: string;
    block_failed: string;
  };
  groups: {
    empty: string;
    create_title: string;
    create_name: string;
    create_description: string;
    create_submit: string;
    info_title: string;
    members: string;
    members_loading: string;
    members_failed: string;
    leave: string;
    leave_confirm: string;
    leave_failed: string;
    role_owner: string;
    role_admin: string;
    add_member: string;
    add_member_pick: string;
    add_member_no_friends: string;
    add_member_failed: string;
    add_member_added: string;
    add_member_tab_friends: string;
    add_member_tab_search: string;
    add_member_search_placeholder: string;
    add_member_search_hint: string;
    add_member_search_empty: string;
    remove_member: string;
    remove_member_confirm: string;
    remove_member_failed: string;
    mute_member: string;
    unmute_member: string;
    muted_badge: string;
    mute_failed: string;
    info_button: string;
    promote_admin: string;
    demote_admin: string;
    set_role_failed: string;
    transfer_owner: string;
    transfer_owner_confirm: string;
    transfer_owner_failed: string;
    settings_heading: string;
    settings_edit: string;
    settings_edit_title: string;
    settings_description: string;
    settings_description_placeholder: string;
    settings_announcement: string;
    settings_announcement_placeholder: string;
    settings_mute_all: string;
    settings_save: string;
    settings_cancel: string;
    settings_save_failed: string;
    mute_all_failed: string;
    mute_duration_title: string;
    mute_duration_1h: string;
    mute_duration_1d: string;
    mute_duration_7d: string;
    mute_duration_30d: string;
    mute_duration_forever: string;
  };
  connection: {
    connected: string;
    connecting: string;
    disconnected: string;
  };
  presence: {
    online: string;
    offline: string;
    just_now: string;
    minutes_ago: string;
    hours_ago: string;
    days_ago: string;
    long_ago: string;
  };
  copy: {
    label: string;
    copied: string;
    user_id: string;
    username: string;
  };
  logs: {
    open: string;
    title: string;
    empty: string;
    copy_all: string;
    clear: string;
  };
}

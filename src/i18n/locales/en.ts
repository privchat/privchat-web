// English (default fallback for vi until proper translations land).
//
// `as const` would freeze every leaf into a string-literal type, forcing
// other locales to use the same English literal. We want the SHAPE
// pinned but each leaf to accept any string — so we apply the schema
// type explicitly without `as const`.
export const en: LocaleSchema = {
  app: {
    name: '{{brand}}',
    loading: 'Loading…',
    system_notifications: 'System Messages',
    unknown_user: 'User #{{id}}',
    unknown_group: 'Group Chat',
  },
  system_template: {
    member_invited: '{0} invited {1+} to the group',
    group_mute_all_on: '{0} muted all members',
    group_mute_all_off: '{0} unmuted all members',
  },
  update: {
    title: 'New version available',
    desc: 'Refresh to get the latest version',
    refresh: 'Refresh',
    cancel: 'Cancel',
  },
  login: {
    title: '{{brand}}',
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
    error_username_taken: 'This username is unavailable or already taken. Please choose another.',
    error_username_reserved: 'This username is unavailable or already taken. Please choose another.',
    error_username_format: 'Invalid username format (lowercase letter first, 3-32 chars).',
    error_password_short: 'Password must be at least 8 characters.',
    error_invalid_credentials: 'Incorrect username or password.',
    error_account_disabled: 'This account has been disabled.',
    error_network: 'Network error. Please try again later.',
    error_protocol: 'Unexpected response from server. Please try again later.',
    error_config: 'Platform configuration error. Contact your administrator.',
    qr_tab: 'Scan QR',
    sms_tab: 'SMS',
    password_tab: 'Account',
    username_ph: 'Username (starts with a letter, 3-32)',
    password_ph: 'Password',
    password_new_ph: 'Password (min 8 chars)',
    nickname_ph: 'Nickname (optional)',
    nickname_required_ph: 'Nickname',
    invite_code_ph: 'Invite code (optional)',
    invite_code_required_ph: 'Invite code',
    to_register: "No account? Create one",
    to_login: 'Have an account? Sign in',
    register_btn: 'Create account',
    qr_loading: 'Generating QR code…',
    qr_waiting_title: 'Scan with the {{brand}} app',
    qr_waiting_subtitle: 'Open {{brand}} on your phone, tap "Scan", and point at this QR code.',
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
      title: 'Welcome to {{brand}}',
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
      message: 'Your account needs to complete "{{title}}", but the current build does not support it yet. Please update the app to continue.',
      message_fallback: 'Your account needs to complete a required action that the current build does not support yet. Please update the app to continue.',
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
  sign_in: {
    open_button: 'Daily sign-in',
    title: 'Daily sign-in',
    continuous_days: 'Streak',
    total_days: 'Total',
    rewards_heading: 'Rewards',
    day_label: 'Day {{day}}',
    points: '{{points}} pts',
    earned: 'Signed in! +{{points}} points',
    sign_now: 'Sign in',
    already_signed: 'Already signed in today',
    sign_failed: 'Sign-in failed',
    no_session: 'No active session.',
  },
  workspace: {
    msg_search_title: 'Search messages',
    msg_search_placeholder: 'Search message content (min 2 chars)',
    msg_search_empty: 'No messages found.',
    msg_search_load_more: 'Load more',
    msg_search_open: 'Search messages',
    msg_search_jump_failed: 'Message unavailable',
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
  // Conversation-list preview placeholders for non-text messages. Keys
  // match `MessageItemVM.content_type` (minus `text`, which shows content).
  message_preview: {
    image: '[Image]',
    video: '[Video]',
    voice: '[Voice]',
    file: '[File]',
    system: '[System]',
    sticker: '[Sticker]',
    contact_card: '[Contact]',
    location: '[Location]',
    link: '[Link]',
    forward: '[Forwarded]',
    red_packet: '[Red packet]',
    money_transfer: '[Transfer]',
    unknown: '[Message]',
  },
  media_send: {
    uploading: 'Uploading…',
    upload_failed: 'Upload failed — tap to retry',
    retry: 'Retry',
    dismiss: 'Remove',
    reselect: 'Please re-select the file to send',
  },
  session_expired: {
    title: 'Session expired',
    body: 'Your session is no longer valid. Please sign in again.',
    confirm: 'Sign in again',
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
  qrcode: {
    // entry points (menus / buttons)
    my_qr: 'My QR code',
    group_qr: 'Group QR code',
    scan_entry: 'Scan / paste a QR link',
    // display dialog
    user_title: 'My QR code',
    group_title: '{{name}} · QR code',
    user_hint: 'Anyone who scans this can add you as a friend.',
    group_hint: 'Anyone who scans this can request to join this group.',
    rotate: 'Replace this QR code',
    retry: 'Try again',
    copy_url: 'Copy URL',
    copied: 'Link copied',
    confirm_rotate_user: 'Replace your QR code? The old link will immediately stop working.',
    confirm_rotate_group: 'Replace this group QR code? The old link will immediately stop working.',
    // scan dialog
    scan_title: 'Scan / paste a QR link',
    scan_input_label: 'Paste the URL you scanned or received.',
    scan_submit: 'Open',
    scan_reset: 'Done',
    scan_not_privchat: 'Unrecognized QR link.',
    scan_unsupported: 'Link "{{entity}}/{{action}}" is not supported by this version. Please update the app.',
    scan_user_self: 'This is your own QR code.',
    scan_user_open_chat: 'Open chat',
    scan_user_send_message: 'Send a message',
    scan_user_add_friend: 'Add friend',
    scan_user_apply_message_label: 'Message (optional)',
    scan_user_apply_message_placeholder: 'Say hi — this is the note attached to your request.',
    scan_user_friend_request_sent: 'Friend request sent to {{name}}.',
    scan_group_about_to_join: 'You are about to request to join this group.',
    scan_group_confirm_join: 'Request to join',
    scan_group_joined: 'You joined the group.',
    scan_group_open: 'Open group',
    scan_group_pending: 'Your request was submitted and is pending owner / admin approval.',
    scan_group_unknown_status: 'Unknown server response: {{status}}',
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
    pin: 'Pin',
    unpin: 'Unpin',
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
    switch_failed: 'Could not switch — staying on the current account.',
    switch_target_missing: 'Saved sign-in for that account is missing. Add it again.',
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
    accepted_greeting: 'I accepted your friend request. Let’s chat!',
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
    add_friend_failed: 'Could not send friend request',
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
      'Transfer group ownership to {{name}}? You will no longer be the owner and become a regular member.',
    transfer_owner_failed: 'Transfer failed',
    settings_heading: 'Group settings',
    settings_edit: 'Edit',
    settings_edit_title: 'Edit group',
    settings_description: 'Description',
    settings_description_placeholder: 'Tell members what this group is for',
    settings_announcement: 'Announcement',
    settings_announcement_placeholder: 'Pinned at the top for new members',
    settings_mute_all: 'Mute everyone',
    settings_allow_member_add_friend: 'Allow members to add each other',
    settings_allow_search: 'Allow this group to be found in search',
    settings_join_policy: 'Join policy',
    settings_join_policy_none: 'No new members',
    settings_join_policy_approval: 'Approval required',
    settings_join_policy_open: 'Anyone can join',
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
    pinned_bar_title: 'Pinned message',
  },
  connection: {
    connected: 'Connected',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
    reconnecting: 'Reconnecting…',
    syncing: 'Syncing…',
    server_busy: 'Server busy',
    auth_expired: 'Session expired',
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
  invite: {
    required_subtitle: 'An invite code is required to continue',
    binding: 'Binding…',
    title: 'Invite code',
    entry: 'Invite code',
    input_ph: 'Enter invite code',
    bind_btn: 'Bind invite code',
    bound_code: 'Invite code',
    bound_inviter: 'Inviter',
    bound_at: 'Bound at',
    bound_hint: 'Each account can bind one invite code; it cannot be changed.',
    bind_hint: 'Bind an inviter-owned code to become friends automatically.',
    success_friend: 'Bound — you are now friends with the inviter',
    success: 'Invite code bound',
    err_already: 'You have already bound an invite code',
    err_self: 'You cannot bind your own invite code',
    err_invalid: 'Invite code is invalid or expired',
    err_failed: 'Failed to bind, please retry',
    loading: 'Loading…',
  },
  money: {
    card: {
      rp_default_greeting: 'Best wishes and prosperity',
      rp_type_normal: 'Red packet',
      rp_type_lucky: 'Lucky red packet',
      rp_open: 'Open red packet',
      rp_claimed_mine: 'Claimed, added to balance',
      rp_finished: 'All claimed',
      rp_expired: 'Expired',
      tf_title: 'Transfer',
      tf_to: 'Transfer to {{name}}',
      tf_from: '{{name}} sent you money',
      tf_arrived: 'Delivered',
      tf_saved: 'Added to balance',
      tf_refunded: 'Refunded',
      unavailable: '[money message]',
    },
    entry: {
      red_packet: 'Red packet',
      transfer: 'Transfer',
      wallet: 'Wallet',
    },
    rp: {
      send_title: 'Send red packet',
      type_lucky: 'Lucky draw',
      type_normal: 'Normal',
      amount_label: 'Total amount (¥)',
      count_label: 'Count',
      greeting_label: 'Greeting',
      greeting_placeholder: 'Best wishes and prosperity',
      submit: 'Stuff the red packet',
      submit_ok: 'Red packet sent',
      expire_hint: 'Unclaimed red packets are refunded after 24 hours',
      err_amount: 'Please enter a valid amount',
      err_count: 'Please enter a valid count',
      err_dm_count: 'Direct chats allow only 1 red packet',
      err_min_per: 'Amount must cover every packet (at least 1 cent each)',
      detail_title: 'Red packet',
      from: "{{name}}'s red packet",
      claimed_saved: 'Added to wallet balance',
      open_btn: 'Open',
      summary_lucky: 'Claimed {{claimed}}/{{total}}, {{claimedAmount}}/{{totalAmount}}',
      summary_normal: '{{count}} packet(s) totalling {{amount}} — {{status}}',
      best_luck: '🏆 Best luck',
      status_refunded_to_you: 'Unclaimed {{amount}} refunded to your wallet',
      status_all_claimed: 'All claimed',
      status_expired: 'Expired',
      status_waiting: 'Waiting to be claimed',
      status_claimed_by_me: 'Added to wallet balance',
      status_too_slow: 'Too slow — all claimed',
      status_claimable: 'Claimable',
    },
    tf: {
      send_title: 'Transfer',
      to: 'Transfer to {{name}}',
      amount_label: 'Amount (¥)',
      remark_label: 'Note',
      remark_placeholder: 'Optional',
      next: 'Transfer',
      confirm_title: 'Confirm transfer to {{name}}',
      confirm_hint: 'Transfers are instant and cannot be undone. Verify the recipient.',
      confirm: 'Confirm transfer',
      cancel: 'Cancel',
      sent: 'Transfer completed',
      detail_title: 'Transfer details',
      status_ok: 'Transfer successful',
      status_refunded: 'Refunded',
      field_amount: 'Amount',
      field_from: 'From',
      field_to: 'To',
      field_remark: 'Note',
      field_time: 'Time',
      field_order: 'Order ID',
      dm_only: 'Transfers are direct-chat only',
      err_amount: 'Please enter a valid amount',
    },
    wallet: {
      title: 'Wallet',
      available: 'Available',
      total: 'Balance',
      frozen: 'Frozen',
      transactions: 'Transactions',
      tx_empty: 'No transactions yet',
      tx_balance_after: 'Balance {{amount}}',
      load_more: 'Load more',
      loading: 'Loading…',
    },
    wd: {
      entry_withdraw: 'Withdraw',
      entry_cards: 'Bank cards',
      entry_orders: 'Withdrawals',
      cards_title: 'My bank cards',
      cards_empty: 'No bank card bound yet',
      add_card: 'Add bank card',
      delete_card: 'Delete',
      delete_confirm: 'Delete bank card {{card}}?',
      bind_title: 'Add bank card',
      holder_ph: 'Cardholder name',
      bank_ph: 'Bank name',
      bank_code_ph: 'Bank code (optional)',
      card_no_ph: 'Card number',
      bind_submit: 'Bind',
      withdraw_title: 'Withdraw',
      available: 'Available {{amount}}',
      amount_ph: 'Amount (yuan)',
      exceed_available: 'Exceeds available balance',
      select_card: 'Payout card',
      need_card: 'Bind a bank card first',
      submit: 'Submit withdrawal',
      freeze_hint: 'Funds are frozen after submission pending review and payout',
      orders_title: 'Withdrawal history',
      orders_empty: 'No withdrawals yet',
      detail_title: 'Withdrawal detail',
      f_amount: 'Amount',
      f_fee: 'Fee',
      f_actual: 'Actual payout',
      f_status: 'Status',
      f_time: 'Requested at',
      f_reason: 'Reason',
      status_0: 'Pending review',
      status_1: 'Approved',
      status_2: 'Processing',
      status_3: 'Paid',
      status_4: 'Rejected',
      status_5: 'Failed',
      status_6: 'Cancelled',
      status_unknown: 'Unknown',
    },
    biz: {
      recharge: 'Recharge',
      recharge_refund: 'Recharge refund',
      admin_adjust: 'Adjustment',
      withdraw_freeze: 'Withdrawal hold',
      withdraw_unfreeze: 'Withdrawal release',
      withdraw_deduct: 'Withdrawal',
      withdraw_refund: 'Withdrawal refund',
      red_packet_send: 'Red packet sent',
      red_packet_claim: 'Red packet received',
      red_packet_refund: 'Red packet refund',
      transfer_out: 'Transfer out',
      transfer_in: 'Transfer in',
      transfer_refund: 'Transfer refund',
      other: 'Balance change',
    },
    err: {
      not_platform: 'Not a platform account',
      permission: 'Permission denied',
      not_found: 'Record not found',
      conflict_or_balance: 'Operation not allowed in the current state, or insufficient balance',
      bad_params: 'Invalid request, please check and retry',
      auth_expired: 'Session expired, please sign in again',
      load_failed: 'Failed to load, please retry',
      op_failed: 'Operation failed, please retry',
    },
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
  system_template: {
    member_invited: string;
    group_mute_all_on: string;
    group_mute_all_off: string;
  };
  update: {
    title: string;
    desc: string;
    refresh: string;
    cancel: string;
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
    error_username_taken: string;
    error_username_reserved: string;
    error_username_format: string;
    error_password_short: string;
    error_invalid_credentials: string;
    error_account_disabled: string;
    error_protocol: string;
    error_config: string;
    qr_tab: string;
    sms_tab: string;
    password_tab: string;
    username_ph: string;
    password_ph: string;
    password_new_ph: string;
    nickname_ph: string;
    nickname_required_ph: string;
    invite_code_ph: string;
    invite_code_required_ph: string;
    to_register: string;
    to_login: string;
    register_btn: string;
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
  sign_in: {
    open_button: string;
    title: string;
    continuous_days: string;
    total_days: string;
    rewards_heading: string;
    day_label: string;
    points: string;
    earned: string;
    sign_now: string;
    already_signed: string;
    sign_failed: string;
    no_session: string;
  };
  workspace: {
    msg_search_title: string;
    msg_search_placeholder: string;
    msg_search_empty: string;
    msg_search_load_more: string;
    msg_search_open: string;
    msg_search_jump_failed: string;
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
  message_preview: {
    image: string;
    video: string;
    voice: string;
    file: string;
    system: string;
    sticker: string;
    contact_card: string;
    location: string;
    link: string;
    forward: string;
    red_packet: string;
    money_transfer: string;
    unknown: string;
  };
  media_send: {
    uploading: string;
    upload_failed: string;
    retry: string;
    dismiss: string;
    reselect: string;
  };
  session_expired: {
    title: string;
    body: string;
    confirm: string;
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
    pin: string;
    unpin: string;
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
    switch_failed: string;
    switch_target_missing: string;
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
    accepted_greeting: string;
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
    add_friend_failed: string;
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
    settings_allow_member_add_friend: string;
    settings_allow_search: string;
    settings_join_policy: string;
    settings_join_policy_none: string;
    settings_join_policy_approval: string;
    settings_join_policy_open: string;
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
    pinned_bar_title: string;
  };
  connection: {
    connected: string;
    connecting: string;
    disconnected: string;
    reconnecting: string;
    syncing: string;
    server_busy: string;
    auth_expired: string;
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
  qrcode: {
    my_qr: string;
    group_qr: string;
    scan_entry: string;
    user_title: string;
    group_title: string;
    user_hint: string;
    group_hint: string;
    rotate: string;
    retry: string;
    copy_url: string;
    copied: string;
    confirm_rotate_user: string;
    confirm_rotate_group: string;
    scan_title: string;
    scan_input_label: string;
    scan_submit: string;
    scan_reset: string;
    scan_not_privchat: string;
    scan_unsupported: string;
    scan_user_self: string;
    scan_user_open_chat: string;
    scan_user_send_message: string;
    scan_user_add_friend: string;
    scan_user_apply_message_label: string;
    scan_user_apply_message_placeholder: string;
    scan_user_friend_request_sent: string;
    scan_group_about_to_join: string;
    scan_group_confirm_join: string;
    scan_group_joined: string;
    scan_group_open: string;
    scan_group_pending: string;
    scan_group_unknown_status: string;
  };
  invite: {
    required_subtitle: string;
    binding: string;
    title: string;
    entry: string;
    input_ph: string;
    bind_btn: string;
    bound_code: string;
    bound_inviter: string;
    bound_at: string;
    bound_hint: string;
    bind_hint: string;
    success_friend: string;
    success: string;
    err_already: string;
    err_self: string;
    err_invalid: string;
    err_failed: string;
    loading: string;
  };
  money: {
    card: {
      rp_default_greeting: string;
      rp_type_normal: string;
      rp_type_lucky: string;
      rp_open: string;
      rp_claimed_mine: string;
      rp_finished: string;
      rp_expired: string;
      tf_title: string;
      tf_to: string;
      tf_from: string;
      tf_arrived: string;
      tf_saved: string;
      tf_refunded: string;
      unavailable: string;
    };
    entry: {
      red_packet: string;
      transfer: string;
      wallet: string;
    };
    rp: {
      send_title: string;
      type_lucky: string;
      type_normal: string;
      amount_label: string;
      count_label: string;
      greeting_label: string;
      greeting_placeholder: string;
      submit: string;
      submit_ok: string;
      expire_hint: string;
      err_amount: string;
      err_count: string;
      err_dm_count: string;
      err_min_per: string;
      detail_title: string;
      from: string;
      claimed_saved: string;
      open_btn: string;
      summary_lucky: string;
      summary_normal: string;
      best_luck: string;
      status_refunded_to_you: string;
      status_all_claimed: string;
      status_expired: string;
      status_waiting: string;
      status_claimed_by_me: string;
      status_too_slow: string;
      status_claimable: string;
    };
    tf: {
      send_title: string;
      to: string;
      amount_label: string;
      remark_label: string;
      remark_placeholder: string;
      next: string;
      confirm_title: string;
      confirm_hint: string;
      confirm: string;
      cancel: string;
      sent: string;
      detail_title: string;
      status_ok: string;
      status_refunded: string;
      field_amount: string;
      field_from: string;
      field_to: string;
      field_remark: string;
      field_time: string;
      field_order: string;
      dm_only: string;
      err_amount: string;
    };
    wallet: {
      title: string;
      available: string;
      total: string;
      frozen: string;
      transactions: string;
      tx_empty: string;
      tx_balance_after: string;
      load_more: string;
      loading: string;
    };
    wd: {
      entry_withdraw: string;
      entry_cards: string;
      entry_orders: string;
      cards_title: string;
      cards_empty: string;
      add_card: string;
      delete_card: string;
      delete_confirm: string;
      bind_title: string;
      holder_ph: string;
      bank_ph: string;
      bank_code_ph: string;
      card_no_ph: string;
      bind_submit: string;
      withdraw_title: string;
      available: string;
      amount_ph: string;
      exceed_available: string;
      select_card: string;
      need_card: string;
      submit: string;
      freeze_hint: string;
      orders_title: string;
      orders_empty: string;
      detail_title: string;
      f_amount: string;
      f_fee: string;
      f_actual: string;
      f_status: string;
      f_time: string;
      f_reason: string;
      status_0: string;
      status_1: string;
      status_2: string;
      status_3: string;
      status_4: string;
      status_5: string;
      status_6: string;
      status_unknown: string;
    };
    biz: {
      recharge: string;
      recharge_refund: string;
      admin_adjust: string;
      withdraw_freeze: string;
      withdraw_unfreeze: string;
      withdraw_deduct: string;
      withdraw_refund: string;
      red_packet_send: string;
      red_packet_claim: string;
      red_packet_refund: string;
      transfer_out: string;
      transfer_in: string;
      transfer_refund: string;
      other: string;
    };
    err: {
      not_platform: string;
      permission: string;
      not_found: string;
      conflict_or_balance: string;
      bad_params: string;
      auth_expired: string;
      load_failed: string;
      op_failed: string;
    };
  };
}

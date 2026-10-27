package com.disbigle.kit

import kotlinx.serialization.Serializable

/** The signed-in account with what only its owner sees (`verify_credentials`). */
@Serializable
data class CredentialAccount(
  val id: String,
  val displayName: String = "",
  val note: String = "",
  val locked: Boolean = false,
  val bot: Boolean = false,
  val discoverable: Boolean? = null,
  val source: Source? = null,
) {
  @Serializable
  data class Source(
    val note: String? = null,
    val fields: List<Account.Field>? = null,
    val language: String? = null,
    val followRequestsCount: Int? = null,
  )
}

/** The editable profile (`PATCH /api/v1/accounts/update_credentials`). */
data class ProfileDraft(
  val displayName: String,
  /** Plain text: the server turns it into HTML. */
  val note: String,
  val fields: List<Account.Field>,
  /** Followers need approval. */
  val locked: Boolean,
  val bot: Boolean,
  val discoverable: Boolean,
  /** Language of the emails and notifications the server sends. */
  val language: String?,
  val avatar: Upload? = null,
  val header: Upload? = null,
) {
  class Upload(val data: ByteArray, val mimeType: String)

  constructor(account: CredentialAccount) : this(
    displayName = account.displayName,
    note = account.source?.note ?: RichText.plain(account.note),
    fields = account.source?.fields ?: emptyList(),
    locked = account.locked,
    bot = account.bot,
    discoverable = account.discoverable ?: true,
    language = account.source?.language,
  )

  val parts: List<Client.Part>
    get() = buildList {
      add(Client.Part("display_name", displayName))
      add(Client.Part("note", note))
      add(Client.Part("locked", locked.toString()))
      add(Client.Part("bot", bot.toString()))
      add(Client.Part("discoverable", discoverable.toString()))
      val kept = fields.filter { it.name.isNotBlank() }
      // Every slot is sent, so fields removed here are removed on the server too.
      for (index in 0 until 4) {
        val field = kept.getOrNull(index) ?: Account.Field("", "")
        add(Client.Part("fields_attributes[$index][name]", field.name))
        add(Client.Part("fields_attributes[$index][value]", field.value))
      }
      language?.let { add(Client.Part("source[language]", it)) }
      avatar?.let { add(Client.Part("avatar", filename = "avatar.jpg", mimeType = it.mimeType, content = it.data)) }
      header?.let { add(Client.Part("header", filename = "header.jpg", mimeType = it.mimeType, content = it.data)) }
    }
}

suspend fun Client.credentials(): CredentialAccount = get("api/v1/accounts/verify_credentials")

suspend fun Client.updateProfile(draft: ProfileDraft): Account =
  call("PATCH", "api/v1/accounts/update_credentials", body = Client.Body.Multipart(draft.parts))

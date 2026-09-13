export const metadata = { title: "Privacy Policy" };

const UPDATED = "September 13, 2026";

export default function PrivacyPage() {
  return (
    <article className="prose prose-neutral max-w-none">
      <h1>JamSam Social Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated {UPDATED}</p>

      <p>
        JamSam Social is an internal marketing operations tool operated by JamSam Digital. It is used by the JamSam Digital
        team to plan, schedule, and publish social media content and blog articles on behalf of JamSam Digital&apos;s clients.
        This policy explains what information the application stores and how it is used.
      </p>

      <h2>Who uses this application</h2>
      <p>
        Only JamSam Digital team members can sign in. Clients do not have accounts. Client social media accounts are connected
        by JamSam Digital with the client&apos;s authorization as part of their marketing services agreement.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Facebook and Instagram account data.</strong> When a Facebook Page or Instagram professional account is
          connected through Facebook Login, we store the Page ID, Page name, the linked Instagram account ID and username, and
          an access token that allows the application to publish posts and read post performance metrics for that Page and
          account. Tokens are encrypted at rest.
        </li>
        <li>
          <strong>Pinterest account data.</strong> When a Pinterest account is connected, we store the account username, board
          list, and an access token used to create pins.
        </li>
        <li>
          <strong>WordPress and SEO tool credentials</strong> supplied by JamSam Digital for a client&apos;s website, encrypted
          at rest.
        </li>
        <li>
          <strong>Content.</strong> Draft and published posts, captions, images uploaded to the media library, blog article
          drafts, and brand writing guidelines.
        </li>
        <li>
          <strong>Performance metrics</strong> for published posts (for example likes, comments, shares, and reach) retrieved
          from the connected platforms.
        </li>
        <li>
          <strong>Team member account data.</strong> Email address and login credentials for JamSam Digital staff.
        </li>
      </ul>

      <h2>How we use information</h2>
      <p>
        Information is used solely to publish content that JamSam Digital has prepared and approved for a client, to report on
        how that content performs, and to operate the application. We do not sell data, use it for advertising, or share it
        with third parties other than the platforms the content is published to (Meta, Pinterest, the client&apos;s WordPress
        site) and the infrastructure providers that host the application (Vercel and Supabase).
      </p>

      <h2>Data retention and deletion</h2>
      <p>
        Connected account tokens are deleted when a connection is removed in the application or when a client relationship
        ends. Content and metrics are retained while the client relationship is active. To request deletion of any data
        associated with a Facebook Page, Instagram account, or Pinterest account, email{" "}
        <a href="mailto:jamsamcreative@gmail.com">jamsamcreative@gmail.com</a> and we will remove it within 30 days.
      </p>

      <h2>Revoking access</h2>
      <p>
        You can revoke JamSam Social&apos;s access to your Facebook and Instagram accounts at any time from Facebook Settings
        &rarr; Business Integrations, and to Pinterest from Pinterest Settings &rarr; Security &rarr; Connected apps.
        Revoking access immediately stops the application from publishing to or reading from those accounts.
      </p>

      <h2>Security</h2>
      <p>
        Access tokens and credentials are encrypted before storage. The application is served over HTTPS only and is
        restricted to authenticated JamSam Digital team members.
      </p>

      <h2>Contact</h2>
      <p>
        JamSam Digital &middot; <a href="mailto:jamsamcreative@gmail.com">jamsamcreative@gmail.com</a>
      </p>
    </article>
  );
}

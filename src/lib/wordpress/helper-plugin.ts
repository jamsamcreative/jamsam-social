import JSZip from "jszip";

export const HELPER_VERSION = "1.0.0";

export const HELPER_PLUGIN_PHP = `<?php
/*
Plugin Name: JamSam Connector
Description: Lets JamSam Social set Yoast SEO fields through the REST API.
Version: ${HELPER_VERSION}
Author: JamSam Digital
*/
if (!defined('ABSPATH')) { exit; }

add_action('init', function () {
  foreach (['_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_focuskw'] as $key) {
    register_post_meta('post', $key, [
      'show_in_rest' => true,
      'single' => true,
      'type' => 'string',
      'auth_callback' => function () { return current_user_can('edit_posts'); },
    ]);
  }
});

add_action('rest_api_init', function () {
  register_rest_route('jamsam/v1', '/ping', [
    'methods' => 'GET',
    'permission_callback' => function () { return current_user_can('edit_posts'); },
    'callback' => function () { return ['ok' => true, 'version' => '${HELPER_VERSION}']; },
  ]);
});
`;

export async function buildHelperZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.folder("jamsam-connector")!.file("jamsam-connector.php", HELPER_PLUGIN_PHP);
  return zip.generateAsync({ type: "nodebuffer" });
}

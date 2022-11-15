# schemaDocs
The following outlines current database structure

## forms
`id` - The Auto-Incrementing FormID
`form_name` - Custom-set friendly form name
`form_description` - Description of what the form is for (Only used internally at the moment)
`permissions_needed` - Permission role that a user needs, not used at the moment but will be used in the future to restrict access to forms

## submissions
`discord_id` - User's Discord ID from OAuth2, foreign key
`submission_id` - Internal ID for tracking submissions, Auto Increment
`form_id` - The ID of the form, foreign key
`submitted_at` - UNIX timestamp when form was created
`outcome` - Enum constant for outcome. `0` - Unreviewed, `1` - Succeeded, `2` - On Hold, `3` - Failed/Denied

## users
`discord_id` - User's Discord ID
`refresh_token` - User's refresh token for access & guilds.join
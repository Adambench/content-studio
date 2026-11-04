-- With Claude (`fixing`): the column a clip I've commented on waits in, just before Review, on every board that has
-- a Review column and not this one yet. The clips in Review with a comment open move there now.
UPDATE `workspaces` SET `stages` = (
  SELECT json_group_array(json(`v`) ORDER BY `k`) FROM (
    SELECT `value` AS `v`, `key` * 2 AS `k` FROM json_each(`workspaces`.`stages`)
    UNION ALL
    SELECT json_object('id', 'fixing', 'name', 'With Claude'), `key` * 2 - 1 FROM json_each(`workspaces`.`stages`) WHERE json_extract(`value`, '$.id') = 'review'
  )
)
WHERE EXISTS (SELECT 1 FROM json_each(`workspaces`.`stages`) WHERE json_extract(`value`, '$.id') = 'review')
  AND NOT EXISTS (SELECT 1 FROM json_each(`workspaces`.`stages`) WHERE json_extract(`value`, '$.id') = 'fixing');--> statement-breakpoint
UPDATE `pieces` SET `stage` = 'fixing'
WHERE `stage` = 'review'
  AND EXISTS (SELECT 1 FROM `video_notes` WHERE `video_notes`.`piece_id` = `pieces`.`id` AND `video_notes`.`status` = 'open')
  AND EXISTS (SELECT 1 FROM `workspaces`, json_each(`workspaces`.`stages`) WHERE `workspaces`.`id` = `pieces`.`workspace_id` AND json_extract(`value`, '$.id') = 'fixing');

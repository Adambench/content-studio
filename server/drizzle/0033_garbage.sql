-- Garbage (2026-11-13): a card I won't post after all. Every page's board gets the stage after Posted.
UPDATE `workspaces` SET `stages` = json_insert(`stages`, '$[#]', json('{"id":"garbage","name":"Garbage"}')) WHERE `stages` NOT LIKE '%"garbage"%';

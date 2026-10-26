-- NODE approval gateway link: the gateway request that must approve this execution.
alter table approval add column node_request_id text;

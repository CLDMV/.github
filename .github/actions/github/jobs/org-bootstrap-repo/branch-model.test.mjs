import assert from "node:assert/strict";
import { parseBranchModel, readBranchModel, branchModelSkipReason, branchModelPatchBody } from "./branch-model.mjs";

// parseBranchModel
assert.equal(parseBranchModel(""), "");
assert.equal(parseBranchModel(undefined), "");
assert.equal(parseBranchModel(" Dev-Trunk "), "dev-trunk");
for (const v of ["v4", "dev-trunk", "legacy", "custom", "none"]) assert.equal(parseBranchModel(v), v);
assert.throws(() => parseBranchModel("v3"), /Invalid branch_model/);

// readBranchModel
const calls = [];
const values = (list) => async (method, path) => {
	calls.push({ method, path });
	return list;
};
assert.deepEqual(await readBranchModel(values([{ property_name: "branch-model", value: "custom" }]), "CLDMV", "x"), {
	value: "custom",
	error: ""
});
assert.deepEqual(calls[0], { method: "GET", path: "/repos/CLDMV/x/properties/values" });
assert.deepEqual(await readBranchModel(values([{ property_name: "other", value: "a" }]), "CLDMV", "x"), { value: null, error: "" });
assert.deepEqual(await readBranchModel(values([{ property_name: "branch-model", value: null }]), "CLDMV", "x"), {
	value: null,
	error: ""
});
const failing = async () => {
	throw new Error("GET /repos/CLDMV/x/properties/values -> 403: nope");
};
const failed = await readBranchModel(failing, "CLDMV", "x");
assert.equal(failed.value, null);
assert.match(failed.error, /403/);

// branchModelSkipReason
assert.equal(branchModelSkipReason({ current: null, requested: "", force: false }), "");
assert.equal(branchModelSkipReason({ current: "v4", requested: "v4", force: false }), "");
assert.equal(branchModelSkipReason({ current: "dev-trunk", requested: "v4", force: false }), "");
assert.equal(branchModelSkipReason({ current: "none", requested: "", force: false }), "");
assert.match(branchModelSkipReason({ current: "legacy", requested: "", force: false }), /legacy/);
assert.match(branchModelSkipReason({ current: "custom", requested: "v4", force: false }), /custom/);
assert.match(branchModelSkipReason({ current: null, requested: "custom", force: false }), /custom/);
assert.equal(branchModelSkipReason({ current: "custom", requested: "v4", force: true }), "");
assert.equal(branchModelSkipReason({ current: null, requested: "legacy", force: true }), "");

// branchModelPatchBody
assert.deepEqual(branchModelPatchBody("x", "dev-trunk"), {
	repository_names: ["x"],
	properties: [{ property_name: "branch-model", value: "dev-trunk" }]
});
console.log("branch-model tests passed");

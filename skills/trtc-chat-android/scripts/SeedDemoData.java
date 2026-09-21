// Seed preset Chat demo data via Tencent Cloud IM REST API.
// Standard library only. JDK 8+ compile/run; JDK 11+ single-file run.
// Default mode is dry-run (zero network).
//
// Run (JDK 11+): java SeedDemoData.java [--apply|--self-test|--help]
// Run (JDK 8):   javac SeedDemoData.java && java SeedDemoData [--apply|--self-test|--help]

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Base64;
import java.util.zip.Deflater;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public class SeedDemoData {

    static final Charset UTF8 = Charset.forName("UTF-8");

    static long SDKAPPID = parseLongEnv("TIM_SDKAPPID", 0);
    static String SECRETKEY = envOr("TIM_SECRETKEY", "");
    static String ADMIN = envOr("TIM_ADMIN", "administrator");
    static String ADMIN_USERSIG = envOr("TIM_ADMIN_USERSIG", "");
    static String REGION = envOr("TIM_REGION", "cn");
    static String CURRENT_USER = envOr("TIM_CURRENT_USER", "");
    static String USERSIG = "";
    static boolean DIE_THROWS = false;

    static String U1_ID = "demo_alice";
    static String U1_NICK = "Alice";
    static String U1_FACE = "https://im.sdk.qcloud.com/download/tuikit-resource/avatar/avatar_2.png";
    static String U2_ID = "demo_bob";
    static String U2_NICK = "Bob";
    static String U2_FACE = "https://im.sdk.qcloud.com/download/tuikit-resource/avatar/avatar_3.png";
    static String U3_ID = "demo_charlie";
    static String U3_NICK = "Charlie";
    static String U3_FACE = "https://im.sdk.qcloud.com/download/tuikit-resource/avatar/avatar_4.png";

    static String G_ID = "DemoPublicGroup";
    static String G_NAME = "Demo Public Group";
    static String G_FACE = "https://im.sdk.qcloud.com/download/tuikit-resource/group-avatar/group_avatar_11.png";

    static String MSG_U1_TO_U2 = "Hi Bob! This is Alice. Welcome to the Chat demo.";
    static String MSG_U2_TO_U1 = "Hi Alice! Glad to join. The Chat UIKit looks great.";
    static String MSG_GROUP = "Welcome to the demo group! Feel free to say hello.";

    static String currentUser() {
        return CURRENT_USER == null ? "" : CURRENT_USER.trim();
    }

    static List<String[]> demoCandidates() {
        List<String[]> users = new ArrayList<String[]>();
        users.add(new String[]{U1_ID, U1_NICK, U1_FACE});
        users.add(new String[]{U2_ID, U2_NICK, U2_FACE});
        users.add(new String[]{U3_ID, U3_NICK, U3_FACE});
        return users;
    }

    static List<String[]> selectedPartners() {
        String uid = currentUser();
        List<String[]> users = new ArrayList<String[]>();
        for (String[] user : demoCandidates()) {
            if (!user[0].equals(uid) && users.size() < 2) users.add(user);
        }
        return users;
    }

    static List<String> participantIds() {
        List<String> ids = new ArrayList<String>();
        String uid = currentUser();
        if (!uid.isEmpty()) ids.add(uid);
        for (String[] user : selectedPartners()) ids.add(user[0]);
        return ids;
    }

    static String groupId() {
        String uid = currentUser();
        if (uid.isEmpty()) return G_ID;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(uid.getBytes(UTF8));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format("%02x", b & 0xff));
            return "DemoPublicGroup_" + hex.substring(0, 12);
        } catch (Exception e) {
            die("cannot derive group id", null);
            return null;
        }
    }

    static String groupOwner() {
        String uid = currentUser();
        return uid.isEmpty() ? selectedPartners().get(0)[0] : uid;
    }

    static List<String> groupMemberIds() {
        String owner = groupOwner();
        List<String> members = new ArrayList<String>();
        for (String uid : participantIds()) {
            if (!uid.equals(owner)) members.add(uid);
        }
        return members;
    }

    static List<String[]> friendshipPairs() {
        String uid = currentUser();
        List<String[]> partners = selectedPartners();
        List<String[]> pairs = new ArrayList<String[]>();
        if (uid.isEmpty()) {
            pairs.add(new String[]{partners.get(0)[0], partners.get(1)[0]});
            pairs.add(new String[]{partners.get(1)[0], partners.get(0)[0]});
            return pairs;
        }
        for (String[] partner : partners) {
            pairs.add(new String[]{uid, partner[0]});
            pairs.add(new String[]{partner[0], uid});
        }
        return pairs;
    }

    static List<String[]> c2cMessages() {
        String uid = currentUser();
        List<String[]> partners = selectedPartners();
        List<String[]> messages = new ArrayList<String[]>();
        if (uid.isEmpty()) {
            messages.add(new String[]{partners.get(0)[0], partners.get(1)[0], MSG_U1_TO_U2});
            messages.add(new String[]{partners.get(1)[0], partners.get(0)[0], MSG_U2_TO_U1});
            return messages;
        }
        for (String[] partner : partners) {
            messages.add(new String[]{partner[0], uid, "Hi! I'm " + partner[1] + ". Welcome to the Chat demo."});
            messages.add(new String[]{uid, partner[0], "Hi " + partner[1] + "! Glad to try the Chat UIKit."});
        }
        return messages;
    }

    static String groupMessageSender() {
        return selectedPartners().get(0)[0];
    }

    static final Map<String, String> REGION_HOST = new LinkedHashMap<String, String>();
    static {
        REGION_HOST.put("cn", "console.tim.qq.com");
        REGION_HOST.put("sgp", "adminapisgp.im.qcloud.com");
        REGION_HOST.put("kr", "adminapikr.im.qcloud.com");
        REGION_HOST.put("jpn", "adminapijpn.im.qcloud.com");
        REGION_HOST.put("ger", "adminapiger.im.qcloud.com");
        REGION_HOST.put("usa", "adminapiusa.im.qcloud.com");
        REGION_HOST.put("idn", "adminapiidn.im.qcloud.com");
        REGION_HOST.put("ksa", "adminapiksa.im.qcloud.com");
    }

    static final String ADD_SOURCE = "AddSource_Type_Demo";

    static List<String> expectedCalls() {
        List<String> calls = new ArrayList<String>();
        if (!currentUser().isEmpty()) calls.add("v4/im_open_login_svc/account_check");
        calls.add("v4/im_open_login_svc/multiaccount_import");
        calls.add("v4/im_open_login_svc/account_check");
        for (int i = 0; i < friendshipPairs().size(); i++) calls.add("v4/sns/friend_import");
        for (int i = 0; i < friendshipPairs().size(); i++) calls.add("v4/sns/friend_get_list");
        calls.add("v4/group_open_http_svc/create_group");
        calls.add("v4/group_open_http_svc/get_group_info");
        calls.add("v4/group_open_http_svc/get_role_in_group");
        for (int i = 0; i < c2cMessages().size(); i++) calls.add("v4/openim/sendmsg");
        calls.add("v4/group_open_http_svc/send_group_msg");
        calls.add("v4/group_open_http_svc/group_msg_get_simple");
        return calls;
    }

    static void out(String m) {
        System.out.println(m == null ? "" : m);
    }

    static void die(String label, Object resp) {
        if (DIE_THROWS) throw new IllegalStateException(label);
        out("");
        out("[FAIL] " + label);
        if (resp != null) out(jsonDump(resp));
        System.exit(1);
    }

    static String genUsersig(long sdkappid, String secretkey, String identifier, long expire) throws Exception {
        long curr = System.currentTimeMillis() / 1000L;
        String raw = "TLS.identifier:" + identifier + "\n"
                + "TLS.sdkappid:" + sdkappid + "\n"
                + "TLS.time:" + curr + "\n"
                + "TLS.expire:" + expire + "\n";
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secretkey.getBytes(UTF8), "HmacSHA256"));
        String sig = Base64.getEncoder().encodeToString(mac.doFinal(raw.getBytes(UTF8)));
        String doc = "{"
                + jstr("TLS.ver") + ":" + jstr("2.0") + ","
                + jstr("TLS.identifier") + ":" + jstr(identifier) + ","
                + jstr("TLS.sdkappid") + ":" + sdkappid + ","
                + jstr("TLS.expire") + ":" + expire + ","
                + jstr("TLS.time") + ":" + curr + ","
                + jstr("TLS.sig") + ":" + jstr(sig)
                + "}";
        Deflater d = new Deflater();
        d.setInput(doc.getBytes(UTF8));
        d.finish();
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[1024];
        while (!d.finished()) {
            int n = d.deflate(buf);
            bos.write(buf, 0, n);
        }
        d.end();
        String b64 = Base64.getEncoder().encodeToString(bos.toByteArray());
        return b64.replace('+', '*').replace('/', '-').replace('=', '_');
    }

    interface Poster {
        Object post(String service, String command, String body);
    }

    static Poster POSTER = new Poster() {
        public Object post(String service, String command, String body) {
            return httpPost(service, command, body);
        }
    };

    static Object apiPost(String service, String command, String body) {
        return POSTER.post(service, command, body);
    }

    static long rand32() {
        return 1L + (long) (Math.random() * 4294967295.0);
    }

    static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    static String readAll(InputStream is) throws IOException {
        if (is == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        return new String(bos.toByteArray(), UTF8);
    }

    static Object httpPost(String service, String command, String body) {
        String host = REGION_HOST.containsKey(REGION) ? REGION_HOST.get(REGION) : REGION_HOST.get("cn");
        String qs = "sdkappid=" + enc(String.valueOf(SDKAPPID))
                + "&identifier=" + enc(ADMIN)
                + "&usersig=" + enc(USERSIG)
                + "&random=" + enc(String.valueOf(rand32()))
                + "&contenttype=json";
        String text;
        int code;
        try {
            URL url = new URL("https://" + host + "/" + service + "/" + command + "?" + qs);
            HttpURLConnection con = (HttpURLConnection) url.openConnection();
            con.setRequestMethod("POST");
            con.setDoOutput(true);
            con.setConnectTimeout(20000);
            con.setReadTimeout(20000);
            con.setRequestProperty("Content-Type", "application/json");
            OutputStream os = con.getOutputStream();
            try {
                os.write(body.getBytes(UTF8));
            } finally {
                os.close();
            }
            code = con.getResponseCode();
            InputStream is = code < 400 ? con.getInputStream() : con.getErrorStream();
            text = readAll(is);
        } catch (IOException e) {
            die("Network error when calling " + service + "/" + command, null);
            return null;
        }
        if (code < 200 || code >= 300) {
            die("HTTP " + code + " when calling " + service + "/" + command + "\n" + text, null);
            return null;
        }
        try {
            return jsonParse(text);
        } catch (Exception e) {
            die("Non-JSON response from " + service + "/" + command + ":\n" + text, null);
            return null;
        }
    }

    static void assertOk(Object resp, String label) {
        if (!"OK".equals(asStr(get(resp, "ActionStatus"))) || asLong(get(resp, "ErrorCode")) != 0) {
            die(label, resp);
        }
    }

    static void step1() {
        String uid = currentUser();
        List<String[]> partners = selectedPartners();
        out("==> Step 1/5: prepare users");
        if (!uid.isEmpty()) {
            out("    [CHECK] v4/im_open_login_svc/account_check (" + uid + ")");
            String existingBody = "{\"CheckItem\":[{\"UserID\":" + jstr(uid) + "}]}";
            Object existing = apiPost("v4/im_open_login_svc", "account_check", existingBody);
            assertOk(existing, "current user account_check failed");
            String currentStatus = null;
            for (Object it : asList(get(existing, "ResultItem"))) {
                if (uid.equals(asStr(get(it, "UserID")))) {
                    currentStatus = asStr(get(it, "AccountStatus"));
                }
            }
            if (!"Imported".equals(currentStatus)) {
                die("current user " + uid + " is not imported; log in or import it before creating demo data", existing);
            }
            out("    [CHECK] current user " + uid + " = Imported");
        }

        out("    [CALL] v4/im_open_login_svc/multiaccount_import");
        StringBuilder body = new StringBuilder("{\"AccountList\":[");
        for (int i = 0; i < partners.size(); i++) {
            if (i > 0) body.append(",");
            String[] user = partners.get(i);
            body.append("{\"UserID\":").append(jstr(user[0]))
                    .append(",\"Nick\":").append(jstr(user[1]))
                    .append(",\"FaceUrl\":").append(jstr(user[2])).append("}");
        }
        body.append("]}");
        Object resp = apiPost("v4/im_open_login_svc", "multiaccount_import", body.toString());
        assertOk(resp, "import users failed");
        List<Object> fails = asList(get(resp, "FailAccounts"));
        if (!fails.isEmpty()) die("user import failed: " + fails, resp);
        out("    [OK] import request succeeded");

        out("    [CHECK] v4/im_open_login_svc/account_check");
        StringBuilder cbody = new StringBuilder("{\"CheckItem\":[");
        List<String> participants = participantIds();
        for (int i = 0; i < participants.size(); i++) {
            if (i > 0) cbody.append(",");
            cbody.append("{\"UserID\":").append(jstr(participants.get(i))).append("}");
        }
        cbody.append("]}");
        Object chk = apiPost("v4/im_open_login_svc", "account_check", cbody.toString());
        assertOk(chk, "account_check failed");
        Map<String, String> status = new HashMap<String, String>();
        for (Object it : asList(get(chk, "ResultItem"))) {
            status.put(asStr(get(it, "UserID")), asStr(get(it, "AccountStatus")));
        }
        for (String userId : participants) {
            if (!"Imported".equals(status.get(userId))) {
                die("account " + userId + " not imported (status=" + status.get(userId) + ")", chk);
            }
            out("    [CHECK] " + userId + " = Imported");
        }
        out("    [PASS] step 1");
        out("");
    }

    static void importFriend(String fromAcc, String toAcc) {
        String body = "{\"From_Account\":" + jstr(fromAcc) + ",\"AddFriendItem\":[{\"To_Account\":" + jstr(toAcc)
                + ",\"AddSource\":" + jstr(ADD_SOURCE) + "}]}";
        Object resp = apiPost("v4/sns", "friend_import", body);
        assertOk(resp, "friend_import " + fromAcc + " -> " + toAcc + " failed");
        List<Object> items = asList(get(resp, "ResultItem"));
        if (items.isEmpty() || asLong(get(items.get(0), "ResultCode")) != 0) {
            die("friend_import " + fromAcc + " -> " + toAcc + " failed", resp);
        }
    }

    static void checkFriend(String fromAcc, String toAcc) {
        String body = "{\"From_Account\":" + jstr(fromAcc) + ",\"To_Account\":[" + jstr(toAcc)
                + "],\"TagList\":[\"Tag_Profile_IM_Nick\",\"Tag_SNS_IM_Remark\"]}";
        Object resp = apiPost("v4/sns", "friend_get_list", body);
        assertOk(resp, "friend_get_list " + fromAcc + " -> " + toAcc + " failed");
        for (Object it : asList(get(resp, "InfoItem"))) {
            if (toAcc.equals(asStr(get(it, "To_Account"))) && asLong(get(it, "ResultCode")) == 0) return;
        }
        die("friend relation missing: " + fromAcc + " -> " + toAcc, resp);
    }

    static void step2() {
        List<String[]> pairs = friendshipPairs();
        out("==> Step 2/5: import friend relations");
        for (String[] pair : pairs) {
            out("    [CALL] v4/sns/friend_import (" + pair[0] + " -> " + pair[1] + ")");
            importFriend(pair[0], pair[1]);
        }
        out("    [OK] friend import succeeded");

        out("    [CHECK] v4/sns/friend_get_list");
        for (String[] pair : pairs) {
            checkFriend(pair[0], pair[1]);
            out("    [CHECK] " + pair[0] + " contains " + pair[1]);
        }
        out("    [PASS] step 2");
        out("");
    }

    static String step3() {
        String targetGroupId = groupId();
        out("==> Step 3/5: create or reuse Public group");
        out("    [CALL] v4/group_open_http_svc/create_group");
        StringBuilder body = new StringBuilder();
        body.append("{\"Owner_Account\":").append(jstr(groupOwner()))
                .append(",\"Type\":\"Public\",\"Name\":").append(jstr(G_NAME))
                .append(",\"FaceUrl\":").append(jstr(G_FACE))
                .append(",\"MemberList\":[");
        List<String> members = groupMemberIds();
        for (int i = 0; i < members.size(); i++) {
            if (i > 0) body.append(",");
            body.append("{\"Member_Account\":").append(jstr(members.get(i))).append("}");
        }
        body.append("]");
        if (targetGroupId != null && !targetGroupId.isEmpty()) {
            body.append(",\"GroupId\":").append(jstr(targetGroupId));
        }
        body.append("}");

        Object resp = apiPost("v4/group_open_http_svc", "create_group", body.toString());
        long errorCode = asLong(get(resp, "ErrorCode"));
        String groupId;
        if (errorCode == 0) {
            groupId = asStr(get(resp, "GroupId"));
            out("    [OK] group created GroupId=" + groupId);
        } else if (errorCode == 10025
                && targetGroupId != null && !targetGroupId.isEmpty()) {
            groupId = targetGroupId;
            out("    [OK] group exists, reuse GroupId=" + groupId + " (ErrorCode=" + errorCode + ")");
        } else {
            die("create_group failed", resp);
            return null;
        }

        out("    [CHECK] v4/group_open_http_svc/get_group_info");
        String cbody = "{\"GroupIdList\":[" + jstr(groupId) + "]}";
        Object chk = apiPost("v4/group_open_http_svc", "get_group_info", cbody);
        assertOk(chk, "get_group_info failed");
        List<Object> infos = asList(get(chk, "GroupInfo"));
        if (infos.isEmpty() || asLong(get(infos.get(0), "ErrorCode")) != 0) die("group " + groupId + " missing or unavailable", chk);
        Object g0 = infos.get(0);
        int expectedMembers = participantIds().size();
        if (asLong(get(g0, "MemberNum")) != expectedMembers) {
            die("group " + groupId + " expected " + expectedMembers + " members", chk);
        }
        out("    [CHECK] group exists: " + asStr(get(g0, "GroupId")) + " (Type=" + asStr(get(g0, "Type"))
                + ", members=" + asStr(get(g0, "MemberNum")) + ")");

        out("    [CHECK] v4/group_open_http_svc/get_role_in_group");
        StringBuilder roleBody = new StringBuilder("{\"GroupId\":").append(jstr(groupId))
                .append(",\"User_Account\":[");
        List<String> participants = participantIds();
        for (int i = 0; i < participants.size(); i++) {
            if (i > 0) roleBody.append(",");
            roleBody.append(jstr(participants.get(i)));
        }
        roleBody.append("]}");
        Object rolesResp = apiPost("v4/group_open_http_svc", "get_role_in_group", roleBody.toString());
        assertOk(rolesResp, "get_role_in_group failed");
        Map<String, String> roles = new HashMap<String, String>();
        for (Object item : asList(get(rolesResp, "UserIdList"))) {
            roles.put(asStr(get(item, "Member_Account")), asStr(get(item, "Role")));
        }
        if (!"Owner".equals(roles.get(groupOwner()))) {
            die("group " + groupId + " owner mismatch", rolesResp);
        }
        for (String member : groupMemberIds()) {
            String role = roles.get(member);
            if (!"Member".equals(role) && !"Admin".equals(role)) {
                die("group " + groupId + " missing member " + member, rolesResp);
            }
        }
        out("    [CHECK] owner and members match the plan");
        out("    [PASS] step 3");
        out("");
        return groupId;
    }

    static String sendC2C(String fromAcc, String toAcc, String text) {
        String body = "{\"SyncOtherMachine\":1,\"From_Account\":" + jstr(fromAcc) + ",\"To_Account\":" + jstr(toAcc)
                + ",\"MsgRandom\":" + rand32()
                + ",\"MsgBody\":[{\"MsgType\":\"TIMTextElem\",\"MsgContent\":{\"Text\":" + jstr(text) + "}}]}";
        Object resp = apiPost("v4/openim", "sendmsg", body);
        assertOk(resp, "sendmsg " + fromAcc + " -> " + toAcc + " failed");
        String key = asStr(get(resp, "MsgKey"));
        if (key == null || key.isEmpty()) die("sendmsg " + fromAcc + " -> " + toAcc + " missing MsgKey", resp);
        return key;
    }

    static void step4() {
        out("==> Step 4/5: send C2C text");
        for (String[] message : c2cMessages()) {
            out("    [CALL] v4/openim/sendmsg (" + message[0] + " -> " + message[1] + ")");
            String key = sendC2C(message[0], message[1], message[2]);
            out("    [CHECK] sent MsgKey=" + key);
        }
        out("    [PASS] step 4");
        out("");
    }

    static void step5(String groupId) {
        out("==> Step 5/5: send group text");
        out("    [CALL] v4/group_open_http_svc/send_group_msg");
        String body = "{\"GroupId\":" + jstr(groupId) + ",\"From_Account\":" + jstr(groupMessageSender())
                + ",\"Random\":" + rand32()
                + ",\"MsgBody\":[{\"MsgType\":\"TIMTextElem\",\"MsgContent\":{\"Text\":" + jstr(MSG_GROUP) + "}}]}";
        Object resp = apiPost("v4/group_open_http_svc", "send_group_msg", body);
        assertOk(resp, "send_group_msg failed");
        out("    [OK] group message sent MsgSeq=" + asStr(get(resp, "MsgSeq")));

        out("    [CHECK] v4/group_open_http_svc/group_msg_get_simple");
        String cbody = "{\"GroupId\":" + jstr(groupId) + ",\"ReqMsgNumber\":10}";
        Object chk = apiPost("v4/group_open_http_svc", "group_msg_get_simple", cbody);
        assertOk(chk, "group_msg_get_simple failed");
        boolean found = false;
        for (Object m : asList(get(chk, "RspMsgList"))) {
            for (Object elem : asList(get(m, "MsgBody"))) {
                if ("TIMTextElem".equals(asStr(get(elem, "MsgType")))
                        && MSG_GROUP.equals(asStr(get(get(elem, "MsgContent"), "Text")))) {
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
        if (!found) die("group history missing the sent text", chk);
        out("    [CHECK] group history contains the message");
        out("    [PASS] step 5");
        out("");
    }

    static String runSteps() {
        step1();
        step2();
        String groupId = step3();
        step4();
        step5(groupId);
        return groupId;
    }

    static String jstr(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    static String jsonDump(Object o) {
        StringBuilder b = new StringBuilder();
        dump(o, b);
        return b.toString();
    }

    static void dump(Object o, StringBuilder b) {
        if (o == null) {
            b.append("null");
        } else if (o instanceof Map) {
            b.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                if (!first) b.append(',');
                first = false;
                b.append(jstr(String.valueOf(e.getKey()))).append(':');
                dump(e.getValue(), b);
            }
            b.append('}');
        } else if (o instanceof List) {
            b.append('[');
            boolean first = true;
            for (Object x : (List<?>) o) {
                if (!first) b.append(',');
                first = false;
                dump(x, b);
            }
            b.append(']');
        } else if (o instanceof String) {
            b.append(jstr((String) o));
        } else {
            b.append(String.valueOf(o));
        }
    }

    private static String J_SRC;
    private static int J_POS;

    static Object jsonParse(String s) {
        J_SRC = s;
        J_POS = 0;
        skipWs();
        return parseValue();
    }

    static void skipWs() {
        while (J_POS < J_SRC.length() && Character.isWhitespace(J_SRC.charAt(J_POS))) J_POS++;
    }

    static Object parseValue() {
        skipWs();
        char c = J_SRC.charAt(J_POS);
        if (c == '{') return parseObject();
        if (c == '[') return parseArray();
        if (c == '"') return parseString();
        if (c == 't' || c == 'f') return parseBool();
        if (c == 'n') {
            J_POS += 4;
            return null;
        }
        return parseNumber();
    }

    static Map<String, Object> parseObject() {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        J_POS++;
        skipWs();
        if (J_SRC.charAt(J_POS) == '}') {
            J_POS++;
            return m;
        }
        while (true) {
            skipWs();
            String key = parseString();
            skipWs();
            J_POS++;
            Object val = parseValue();
            m.put(key, val);
            skipWs();
            char c = J_SRC.charAt(J_POS++);
            if (c == '}') break;
        }
        return m;
    }

    static List<Object> parseArray() {
        List<Object> a = new ArrayList<Object>();
        J_POS++;
        skipWs();
        if (J_SRC.charAt(J_POS) == ']') {
            J_POS++;
            return a;
        }
        while (true) {
            a.add(parseValue());
            skipWs();
            char c = J_SRC.charAt(J_POS++);
            if (c == ']') break;
        }
        return a;
    }

    static String parseString() {
        StringBuilder b = new StringBuilder();
        J_POS++;
        while (true) {
            char c = J_SRC.charAt(J_POS++);
            if (c == '"') break;
            if (c == '\\') {
                char e = J_SRC.charAt(J_POS++);
                switch (e) {
                    case '"': b.append('"'); break;
                    case '\\': b.append('\\'); break;
                    case '/': b.append('/'); break;
                    case 'n': b.append('\n'); break;
                    case 't': b.append('\t'); break;
                    case 'r': b.append('\r'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'u':
                        int cp = Integer.parseInt(J_SRC.substring(J_POS, J_POS + 4), 16);
                        J_POS += 4;
                        b.append((char) cp);
                        break;
                    default: b.append(e);
                }
            } else {
                b.append(c);
            }
        }
        return b.toString();
    }

    static Object parseNumber() {
        int start = J_POS;
        while (J_POS < J_SRC.length() && "+-0123456789.eE".indexOf(J_SRC.charAt(J_POS)) >= 0) J_POS++;
        return Double.parseDouble(J_SRC.substring(start, J_POS));
    }

    static Boolean parseBool() {
        if (J_SRC.charAt(J_POS) == 't') {
            J_POS += 4;
            return Boolean.TRUE;
        }
        J_POS += 5;
        return Boolean.FALSE;
    }

    static Object get(Object o, String k) {
        return (o instanceof Map) ? ((Map<?, ?>) o).get(k) : null;
    }

    @SuppressWarnings("unchecked")
    static List<Object> asList(Object o) {
        return (o instanceof List) ? (List<Object>) o : new ArrayList<Object>();
    }

    static long asLong(Object o) {
        if (o instanceof Number) return ((Number) o).longValue();
        if (o instanceof String) {
            try {
                return (long) Double.parseDouble((String) o);
            } catch (Exception e) {
                return Long.MIN_VALUE;
            }
        }
        return Long.MIN_VALUE;
    }

    static String asStr(Object o) {
        if (o == null) return null;
        if (o instanceof Double) {
            double d = (Double) o;
            if (d == Math.floor(d) && !Double.isInfinite(d)) return String.valueOf((long) d);
        }
        return String.valueOf(o);
    }

    static String envOr(String k, String d) {
        String v = System.getenv(k);
        return v == null ? d : v;
    }

    static long parseLongEnv(String k, long d) {
        String v = System.getenv(k);
        if (v == null || v.trim().isEmpty()) return d;
        try {
            return Long.parseLong(v.trim());
        } catch (Exception e) {
            return Long.MIN_VALUE;
        }
    }

    static String regionKeys() {
        StringBuilder b = new StringBuilder();
        boolean first = true;
        for (String k : REGION_HOST.keySet()) {
            if (!first) b.append(", ");
            first = false;
            b.append(k);
        }
        return b.toString();
    }

    static String regionHost() {
        if (!REGION_HOST.containsKey(REGION)) {
            die("unknown region=" + REGION + ", expected: " + regionKeys(), null);
        }
        return REGION_HOST.get(REGION);
    }

    static void printPlan(String mode) {
        String uid = currentUser();
        out("MODE: " + mode);
        out("HOST: " + regionHost());
        out("CURRENT_USER: " + (uid.isEmpty() ? "(none)" : uid));
        out("USERS: " + joinStrings(participantIds()));
        List<String> importedUsers = new ArrayList<String>();
        for (String[] user : selectedPartners()) importedUsers.add(user[0]);
        out("IMPORTED_USERS: " + joinStrings(importedUsers));
        out("LOGIN_USER: " + (uid.isEmpty() ? selectedPartners().get(0)[0] : uid));
        out("GROUP: " + groupId());
        out("GROUP_OWNER: " + groupOwner());
        out("GROUP_MEMBERS: " + joinStrings(groupMemberIds()));
        List<String> friendDirections = new ArrayList<String>();
        for (String[] pair : friendshipPairs()) friendDirections.add(pair[0] + "->" + pair[1]);
        out("FRIENDS: " + joinStrings(friendDirections));
        List<String> c2cDirections = new ArrayList<String>();
        for (String[] message : c2cMessages()) c2cDirections.add(message[0] + "->" + message[1]);
        out("C2C: " + joinStrings(c2cDirections));
        out("GROUP_MESSAGE_FROM: " + groupMessageSender());
        out("WARNING: remote writes create real data; repeated apply adds messages");
        out(uid.isEmpty()
                ? "PLAN 1: multiaccount_import -> account_check"
                : "PLAN 1: verify current user -> multiaccount_import -> account_check");
        out("PLAN 2: friend_import x" + friendshipPairs().size()
                + " -> friend_get_list x" + friendshipPairs().size());
        out("PLAN 3: create_group -> get_group_info -> get_role_in_group");
        out("PLAN 4: sendmsg x" + c2cMessages().size());
        out("PLAN 5: send_group_msg -> group_msg_get_simple");
        if ("DRY-RUN".equals(mode)) {
            out("DRY-RUN: no network requests were sent");
        }
    }

    static String joinStrings(List<String> values) {
        StringBuilder result = new StringBuilder();
        for (String value : values) {
            if (result.length() > 0) result.append(",");
            result.append(value);
        }
        return result.toString();
    }

    static void prepareApplyCredentials() throws Exception {
        if (SDKAPPID < 0) die("invalid SDKAppID. Set TIM_SDKAPPID or --sdkappid to a positive integer.", null);
        if (SDKAPPID == 0) die("missing SDKAppID. Set TIM_SDKAPPID or --sdkappid.", null);
        if (ADMIN_USERSIG != null && !ADMIN_USERSIG.isEmpty()) {
            USERSIG = ADMIN_USERSIG;
        } else if (SECRETKEY != null && !SECRETKEY.isEmpty()) {
            USERSIG = genUsersig(SDKAPPID, SECRETKEY, ADMIN, 86400L * 180);
        } else {
            die("missing credentials. Provide TIM_SECRETKEY/--secretkey or TIM_ADMIN_USERSIG/--usersig.", null);
        }
    }

    static Object mockSuccess(String service, String command, String bodyStr, List<String> calls) {
        calls.add(service + "/" + command);
        Object req = jsonParse(bodyStr);
        String key = service + "/" + command;
        if (key.equals("v4/im_open_login_svc/multiaccount_import")) {
            List<String> actualIds = new ArrayList<String>();
            for (Object item : asList(get(req, "AccountList"))) {
                actualIds.add(asStr(get(item, "UserID")));
            }
            List<String> expectedIds = new ArrayList<String>();
            for (String[] user : selectedPartners()) expectedIds.add(user[0]);
            if (!actualIds.equals(expectedIds) || actualIds.contains(currentUser())) {
                die("self-test imported users mismatch", req);
            }
            return jsonParse("{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"FailAccounts\":[]}");
        }
        if (key.equals("v4/im_open_login_svc/account_check")) {
            StringBuilder ri = new StringBuilder();
            List<Object> ci = asList(get(req, "CheckItem"));
            if (ci.size() == 1 && !currentUser().isEmpty()
                    && !currentUser().equals(asStr(get(ci.get(0), "UserID")))) {
                die("self-test current user check mismatch", req);
            }
            for (int i = 0; i < ci.size(); i++) {
                if (i > 0) ri.append(",");
                ri.append("{\"UserID\":").append(jstr(asStr(get(ci.get(i), "UserID"))))
                        .append(",\"ResultCode\":0,\"AccountStatus\":\"Imported\"}");
            }
            return jsonParse("{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"ResultItem\":[" + ri + "]}");
        }
        if (key.equals("v4/sns/friend_import")) {
            String to = asStr(get(asList(get(req, "AddFriendItem")).get(0), "To_Account"));
            String from = asStr(get(req, "From_Account"));
            boolean found = false;
            for (String[] pair : friendshipPairs()) {
                if (pair[0].equals(from) && pair[1].equals(to)) found = true;
            }
            if (!found) die("self-test friend pair mismatch", req);
            return jsonParse("{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"ResultItem\":[{\"To_Account\":" + jstr(to) + ",\"ResultCode\":0}]}");
        }
        if (key.equals("v4/sns/friend_get_list")) {
            String to = asStr(asList(get(req, "To_Account")).get(0));
            return jsonParse("{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"InfoItem\":[{\"To_Account\":" + jstr(to) + ",\"ResultCode\":0}]}");
        }
        if (key.equals("v4/group_open_http_svc/create_group")) {
            String gid = asStr(get(req, "GroupId"));
            if (gid == null) gid = groupId();
            List<String> actualMembers = new ArrayList<String>();
            for (Object item : asList(get(req, "MemberList"))) {
                actualMembers.add(asStr(get(item, "Member_Account")));
            }
            if (!groupOwner().equals(asStr(get(req, "Owner_Account")))
                    || !actualMembers.equals(groupMemberIds())
                    || !groupId().equals(gid)) {
                die("self-test group request mismatch", req);
            }
            return jsonParse("{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"GroupId\":" + jstr(gid) + "}");
        }
        if (key.equals("v4/group_open_http_svc/get_group_info")) {
            String gid = asStr(asList(get(req, "GroupIdList")).get(0));
            return jsonParse("{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"GroupInfo\":[{\"GroupId\":" + jstr(gid)
                    + ",\"ErrorCode\":0,\"Type\":\"Public\",\"Name\":" + jstr(G_NAME)
                    + ",\"MemberNum\":" + participantIds().size() + "}]}");
        }
        if (key.equals("v4/group_open_http_svc/get_role_in_group")) {
            List<String> actualUsers = new ArrayList<String>();
            for (Object user : asList(get(req, "User_Account"))) actualUsers.add(asStr(user));
            if (!groupId().equals(asStr(get(req, "GroupId")))
                    || !actualUsers.equals(participantIds())) {
                die("self-test group role request mismatch", req);
            }
            StringBuilder users = new StringBuilder();
            for (String uid : participantIds()) {
                if (users.length() > 0) users.append(",");
                users.append("{\"Member_Account\":").append(jstr(uid))
                        .append(",\"Role\":")
                        .append(jstr(uid.equals(groupOwner()) ? "Owner" : "Member"))
                        .append("}");
            }
            return jsonParse("{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"UserIdList\":["
                    + users + "]}");
        }
        if (key.equals("v4/openim/sendmsg")) {
            String to = asStr(get(req, "To_Account"));
            String from = asStr(get(req, "From_Account"));
            String text = asStr(get(
                    get(asList(get(req, "MsgBody")).get(0), "MsgContent"),
                    "Text"
            ));
            boolean found = false;
            for (String[] message : c2cMessages()) {
                if (message[0].equals(from) && message[1].equals(to) && message[2].equals(text)) {
                    found = true;
                }
            }
            if (!found) die("self-test C2C request mismatch", req);
            return jsonParse("{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"MsgKey\":" + jstr("key_" + to) + "}");
        }
        if (key.equals("v4/group_open_http_svc/send_group_msg")) {
            if (!groupId().equals(asStr(get(req, "GroupId")))
                    || !groupMessageSender().equals(asStr(get(req, "From_Account")))) {
                die("self-test group message request mismatch", req);
            }
            return jsonParse("{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"MsgSeq\":1}");
        }
        if (key.equals("v4/group_open_http_svc/group_msg_get_simple")) {
            return jsonParse("{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"RspMsgList\":[{\"From_Account\":"
                    + jstr(groupMessageSender())
                    + ",\"MsgBody\":[{\"MsgType\":\"TIMTextElem\",\"MsgContent\":{\"Text\":"
                    + jstr(MSG_GROUP) + "}}]}]}");
        }
        die("unexpected mock call " + key, null);
        return null;
    }

    static void selfTest() {
        String originalCurrentUser = CURRENT_USER;
        for (String testCurrentUser : new String[]{"", "customer_8472", "demo_alice"}) {
            CURRENT_USER = testCurrentUser;
            List<String> actualPartners = new ArrayList<String>();
            for (String[] user : selectedPartners()) actualPartners.add(user[0]);
            String expectedPartners = testCurrentUser.equals("demo_alice")
                    ? "demo_bob,demo_charlie"
                    : "demo_alice,demo_bob";
            if (!joinStrings(actualPartners).equals(expectedPartners)) {
                die("self-test partner selection mismatch", actualPartners);
            }
            final List<String> calls = new ArrayList<String>();
            POSTER = new Poster() {
                public Object post(String service, String command, String body) {
                    return mockSuccess(service, command, body, calls);
                }
            };
            String gid = runSteps();
            if (!calls.equals(expectedCalls())) {
                die("self-test call order mismatch: " + calls, null);
            }
            if (!testCurrentUser.isEmpty() && !participantIds().contains(testCurrentUser)) {
                die("self-test current user missing from participants", null);
            }
            if (!gid.equals(groupId())) {
                die("self-test group id mismatch", gid);
            }
        }

        CURRENT_USER = "customer_8472";
        final List<String> missingCalls = new ArrayList<String>();
        POSTER = new Poster() {
            public Object post(String service, String command, String body) {
                Object req = jsonParse(body);
                String key = service + "/" + command;
                if (key.equals("v4/im_open_login_svc/account_check")
                        && asList(get(req, "CheckItem")).size() == 1) {
                    missingCalls.add(key);
                    return jsonParse("{\"ActionStatus\":\"OK\",\"ErrorCode\":0,\"ResultItem\":["
                            + "{\"UserID\":" + jstr(currentUser())
                            + ",\"ResultCode\":0,\"AccountStatus\":\"NotImported\"}]}");
                }
                return mockSuccess(service, command, body, missingCalls);
            }
        };
        DIE_THROWS = true;
        boolean missingUserFailed = false;
        try {
            step1();
        } catch (IllegalStateException e) {
            missingUserFailed = e.getMessage() != null && e.getMessage().contains("not imported");
        } finally {
            DIE_THROWS = false;
        }
        if (!missingUserFailed) die("self-test expected an unimported current user to stop", null);

        final List<String> reuseCalls = new ArrayList<String>();
        CURRENT_USER = "customer_8472";
        POSTER = new Poster() {
            public Object post(String service, String command, String body) {
                String key = service + "/" + command;
                if (key.equals("v4/group_open_http_svc/create_group")) {
                    reuseCalls.add(key);
                    return jsonParse("{\"ActionStatus\":\"FAIL\",\"ErrorCode\":10025,\"ErrorInfo\":\"used\"}");
                }
                return mockSuccess(service, command, body, reuseCalls);
            }
        };
        String gid = step3();
        if (!groupId().equals(gid)) die("self-test group reuse failed", gid);
        if (reuseCalls.size() != 3
                || !"v4/group_open_http_svc/create_group".equals(reuseCalls.get(0))
                || !"v4/group_open_http_svc/get_group_info".equals(reuseCalls.get(1))
                || !"v4/group_open_http_svc/get_role_in_group".equals(reuseCalls.get(2))) {
            die("self-test reuse call order mismatch: " + reuseCalls, null);
        }
        CURRENT_USER = originalCurrentUser;
        POSTER = new Poster() {
            public Object post(String service, String command, String body) {
                return httpPost(service, command, body);
            }
        };
        out("SELF-TEST PASS");
    }

    static void printHelp() {
        out("Usage: java SeedDemoData.java [--sdkappid N] [--secretkey K] [--admin A] [--usersig S] [--region R] [--current-user ID] [--apply] [--self-test]");
        out("Default mode is dry-run (zero network). Use --apply to execute remote writes.");
        out("Environment: TIM_SDKAPPID, TIM_SECRETKEY, TIM_ADMIN, TIM_ADMIN_USERSIG, TIM_REGION, TIM_CURRENT_USER.");
        out("Region keys: " + regionKeys());
    }

    static String requireArg(String[] args, int index, String name) {
        if (index >= args.length || args[index].startsWith("--") || args[index].equals("-h")) {
            die("missing value for " + name, null);
            return "";
        }
        return args[index];
    }

    static boolean parseFlags(String[] args) {
        boolean apply = false;
        boolean selfTest = false;
        boolean help = false;
        for (int i = 0; i < args.length; i++) {
            String k = args[i];
            if (k.equals("--sdkappid")) {
                String v = requireArg(args, ++i, "--sdkappid");
                try {
                    SDKAPPID = Long.parseLong(v.trim());
                } catch (NumberFormatException ignored) {
                    die("invalid --sdkappid", null);
                }
            } else if (k.equals("--secretkey")) SECRETKEY = requireArg(args, ++i, "--secretkey");
            else if (k.equals("--admin")) ADMIN = requireArg(args, ++i, "--admin");
            else if (k.equals("--usersig")) ADMIN_USERSIG = requireArg(args, ++i, "--usersig");
            else if (k.equals("--region")) REGION = requireArg(args, ++i, "--region");
            else if (k.equals("--current-user")) CURRENT_USER = requireArg(args, ++i, "--current-user");
            else if (k.equals("--apply")) apply = true;
            else if (k.equals("--self-test")) selfTest = true;
            else if (k.equals("-h") || k.equals("--help")) help = true;
            else die("unknown argument: " + k, null);
        }
        if (REGION != null) {
            REGION = REGION.trim();
            if (REGION.isEmpty()) REGION = "cn";
        }
        CURRENT_USER = currentUser();
        if (help) {
            printHelp();
            System.exit(0);
        }
        if (selfTest) {
            selfTest();
            System.exit(0);
        }
        return apply;
    }

    public static void main(String[] args) throws Exception {
        boolean apply = parseFlags(args);
        if (!apply) {
            printPlan("DRY-RUN");
            return;
        }
        printPlan("APPLY");
        prepareApplyCredentials();
        runSteps();
    }
}
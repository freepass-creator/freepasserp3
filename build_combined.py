# -*- coding: utf-8 -*-
import re, base64, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))

def inline_imgs(html):
    def rep(m):
        fp = m.group(1).lstrip('./')
        if not os.path.exists(fp): return m.group(0)
        return 'src="data:image/png;base64,%s"' % base64.b64encode(open(fp,'rb').read()).decode()
    return re.sub(r'src="(\./assets/[^"]+\.png)"', rep, html)

def body_docs(path):
    h = open(path, encoding='utf-8').read()
    h = inline_imgs(h)
    inner = h.split('<body>',1)[1]
    # cut before pdf button (button or anchor) and </body>
    inner = re.split(r'<(?:button|a) class="pdf-btn"', inner)[0]
    return inner.strip()

agent = body_docs('회사소개서.html')
pro   = body_docs('회사소개서_공급사.html')

# inject faint corner mark into the FIRST .document of each group
def mark(group, txt):
    return group.replace('<div class="document">', '<div class="document"><div class="vmark">%s</div>' % txt, 1)
agent = mark(agent, 'FOR AGENT')
pro   = mark(pro,   'FOR PROVIDER')

head = open('회사소개서.html', encoding='utf-8').read().split('</head>')[0]
extra_css = '''
  .vbar{ position:fixed; top:16px; right:18px; z-index:1000; display:flex; gap:6px; align-items:center; }
  .vbar .vlabel{ font-size:9pt; font-weight:800; letter-spacing:1.5px; color:rgba(27,42,74,.30); margin-right:8px; }
  .vbar button{ font-family:inherit; font-size:9pt; font-weight:700; border:1px solid var(--line); background:#fff; color:var(--ink2); padding:6px 13px; border-radius:999px; cursor:pointer; box-shadow:0 2px 8px rgba(22,49,77,.12); }
  .vbar button.on{ background:var(--navy); color:#fff; border-color:var(--navy); }
  .vmark{ position:absolute; top:14mm; right:22mm; font-size:8.5pt; font-weight:800; letter-spacing:2px; color:rgba(27,42,74,.22); }
  .vgroup{ display:none; }
  body.v-agent .vg-agent{ display:block; }
  body.v-pro .vg-pro{ display:block; }
  @media print{ .vbar{ display:none; } }
  @media screen and (max-width:760px){ .vbar{ top:8px; right:8px; } .vbar .vlabel{ display:none; } .vmark{ right:16px; top:12px; } }
</style>'''
head = head.replace('</style>', extra_css)

agent_pdf = base64.b64encode(open('프리패스모빌리티_회사소개서.pdf','rb').read()).decode()
pro_pdf   = base64.b64encode(open('프리패스모빌리티_공급사안내.pdf','rb').read()).decode()

html = head + '''</head>
<body class="v-agent">

<div class="vbar">
  <button data-v="agent" class="on" onclick="setV('agent')">영업자용</button>
  <button data-v="pro" onclick="setV('pro')">공급사용</button>
</div>

<div class="vgroup vg-agent">
''' + agent + '''
</div>

<div class="vgroup vg-pro">
''' + pro + '''
</div>

<a class="pdf-btn" id="pdfdl" download="프리패스모빌리티_회사소개서.pdf" href="data:application/pdf;base64,''' + agent_pdf + '''" style="text-decoration:none">PDF 다운로드</a>

<script>
var PDFS={agent:{n:'프리패스모빌리티_회사소개서.pdf'},pro:{n:'프리패스모빌리티_공급사안내.pdf'}};
PDFS.agent.h="data:application/pdf;base64,''' + agent_pdf + '''";
PDFS.pro.h="data:application/pdf;base64,''' + pro_pdf + '''";
function setV(v){
  document.body.className='v-'+v;
  document.querySelectorAll('.vbar button').forEach(function(b){b.classList.toggle('on',b.dataset.v===v);});
  var a=document.getElementById('pdfdl'); a.href=PDFS[v].h; a.download=PDFS[v].n;
  window.scrollTo(0,0);
}
</script>
</body>
</html>'''

open('프리패스모빌리티_소개서.html','w',encoding='utf-8').write(html)
print('combined ->', round(len(html)/1024/1024,2),'MB | agent docs:', agent.count('class="document"'), '| pro docs:', pro.count('class="document"'))
